import { randomUUID } from 'node:crypto';
import { Admin, Consumer, Kafka, Producer } from 'kafkajs';
import type Database from 'better-sqlite3';
import { KafkaBootstrap } from '../../src/bootstrap/kafka.bootstrap';
import { openCardIssuancesDatabase } from '../../src/bootstrap/database.bootstrap';
import { CardIssuanceRepositoryInfrastructure } from '../../src/modules/infraestructure/persistance/card-issuance.repository.infraestructure';
import { ProcessCardIssuanceApplication } from '../../src/modules/application/card-issuance.application';
import { ConsumerService } from '../../src/core/services/consumer.service';
import { ProducerService } from '../../src/core/services/producer.service';
import { TransientApprovalError } from '../../src/modules/domain/errors';
import { isValidLuhn } from '../../src/modules/domain/card-generator';
import {
  CARDS_ISSUED_TOPIC,
  CARD_REQUESTED_DLQ_TOPIC,
  CARD_REQUESTED_TOPIC,
} from '../../src/constants/kafka-topics';
import { createLogger } from '../../src/logger';
import { startTestKafkaBroker, TestKafkaBroker } from './support/kafka-test-container';
import { waitFor } from './support/wait-for';

jest.setTimeout(180_000);

function buildRequestedEvent(requestId: string, documentNumber: string, forceError: boolean) {
  return {
    id: 1,
    source: requestId,
    type: CARD_REQUESTED_TOPIC,
    data: {
      customer: {
        documentType: 'DNI',
        documentNumber,
        fullName: 'Jose Peréz',
        age: 25,
        email: 'joseperez@example.com',
      },
      product: { type: 'VISA', currency: 'PEN' },
      forceError,
    },
  };
}

interface ConsumedMessage {
  topic: string;
  key: string | null;
  value: Record<string, unknown>;
}

describe('card-processor: processing of io.card.requested.v1 (integration: real Kafka via Testcontainers)', () => {
  let broker: TestKafkaBroker;
  let db: Database.Database;
  let repository: CardIssuanceRepositoryInfrastructure;
  let producerService: ProducerService;
  let consumerService: ConsumerService;
  let requestProducer: Producer;
  let resultConsumer: Consumer;
  let adminClient: Admin;
  let consumedMessages: ConsumedMessage[];

  beforeAll(async () => {
    broker = await startTestKafkaBroker();

    await new KafkaBootstrap().initialize({
      brokers: [broker.bootstrapServers],
      clientId: 'card-processor-test',
    });
    const kafka: Kafka = KafkaBootstrap.getInstanceKafka();

    adminClient = kafka.admin();
    await adminClient.connect();
    await adminClient.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: CARD_REQUESTED_TOPIC, numPartitions: 1, replicationFactor: 1 },
        { topic: CARDS_ISSUED_TOPIC, numPartitions: 1, replicationFactor: 1 },
        { topic: CARD_REQUESTED_DLQ_TOPIC, numPartitions: 1, replicationFactor: 1 },
      ],
    });

    const logger = createLogger('silent');

    producerService = new ProducerService(logger);
    await producerService.connect();

    db = openCardIssuancesDatabase(':memory:');
    repository = new CardIssuanceRepositoryInfrastructure(db);

    const application = new ProcessCardIssuanceApplication(repository, producerService, logger, {
      simulateExternalApproval: async ({ forceError }) => {
        if (forceError) {
          throw new TransientApprovalError('Simulated external service failure (forceError)');
        }
      },
    });

    consumerService = new ConsumerService(
      application,
      producerService,
      logger,
      'card-processor-test-group',
    );
    await consumerService.connect();

    requestProducer = kafka.producer();
    await requestProducer.connect();

    consumedMessages = [];
    resultConsumer = kafka.consumer({ groupId: 'card-processor-integration-test-results' });
    await resultConsumer.connect();
    await resultConsumer.subscribe({ topic: CARDS_ISSUED_TOPIC, fromBeginning: true });
    await resultConsumer.subscribe({ topic: CARD_REQUESTED_DLQ_TOPIC, fromBeginning: true });
    await resultConsumer.run({
      eachMessage: async ({ topic, message }) => {
        consumedMessages.push({
          topic,
          key: message.key ? message.key.toString() : null,
          value: JSON.parse(message.value?.toString() ?? '{}') as Record<string, unknown>,
        });
      },
    });
  });

  afterAll(async () => {
    await resultConsumer?.disconnect();
    await requestProducer?.disconnect();
    await consumerService?.disconnect();
    await producerService?.disconnect();
    await adminClient?.disconnect();
    db?.close();
    await broker?.stop();
  });

  const happyPathRequestId = randomUUID();
  const happyPathDocumentNumber = '50000001';
  let issuedCardNumberFirstTime: string | undefined;

  it('full happy path: request event → issuance event on io.cards.issued.v1', async () => {
    const event = buildRequestedEvent(happyPathRequestId, happyPathDocumentNumber, false);

    await requestProducer.send({
      topic: CARD_REQUESTED_TOPIC,
      messages: [{ key: happyPathDocumentNumber, value: JSON.stringify(event) }],
    });

    await waitFor(() =>
      consumedMessages.some(
        (m) => m.topic === CARDS_ISSUED_TOPIC && m.value.source === happyPathRequestId,
      ),
    );

    const issuedMessage = consumedMessages.find(
      (m) => m.topic === CARDS_ISSUED_TOPIC && m.value.source === happyPathRequestId,
    );
    expect(issuedMessage).toBeDefined();
    expect(issuedMessage?.key).toBe(happyPathRequestId);

    const data = issuedMessage?.value.data as {
      requestId: string;
      documentNumber: string;
      card: { number: string; expiry: string; cvv: string };
      status: string;
    };
    expect(issuedMessage?.value).toMatchObject({
      id: 2,
      type: CARDS_ISSUED_TOPIC,
      source: happyPathRequestId,
    });
    expect(data.requestId).toBe(happyPathRequestId);
    expect(data.documentNumber).toBe(happyPathDocumentNumber);
    expect(data.status).toBe('issued');
    expect(isValidLuhn(data.card.number)).toBe(true);
    expect(data.card.expiry).toMatch(/^\d{2}\/\d{2}$/);
    expect(data.card.cvv).toMatch(/^\d{3}$/);

    issuedCardNumberFirstTime = data.card.number;

    const row = await repository.findByRequestId(happyPathRequestId);
    expect(row?.status).toBe('issued');
    expect(row?.card?.number).toBe(data.card.number);
  });

  it('reprocessing the same already-issued message: does NOT publish a second io.cards.issued.v1 nor generate a second card', async () => {
    const event = buildRequestedEvent(happyPathRequestId, happyPathDocumentNumber, false);

    await requestProducer.send({
      topic: CARD_REQUESTED_TOPIC,
      messages: [{ key: happyPathDocumentNumber, value: JSON.stringify(event) }],
    });

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const issuedForRequest = consumedMessages.filter(
      (m) => m.topic === CARDS_ISSUED_TOPIC && m.value.source === happyPathRequestId,
    );
    expect(issuedForRequest).toHaveLength(1);

    const row = await repository.findByRequestId(happyPathRequestId);
    expect(row?.card?.number).toBe(issuedCardNumberFirstTime);
  });

  it('forceError: true → after 3 retries are exhausted, reaches the DLQ with reason/attempts/originalPayload', async () => {
    const requestId = randomUUID();
    const documentNumber = '50000002';
    const event = buildRequestedEvent(requestId, documentNumber, true);

    await requestProducer.send({
      topic: CARD_REQUESTED_TOPIC,
      messages: [{ key: documentNumber, value: JSON.stringify(event) }],
    });

    await waitFor(
      () =>
        consumedMessages.some(
          (m) => m.topic === CARD_REQUESTED_DLQ_TOPIC && m.value.source === requestId,
        ),
      30_000,
    );

    const dlqMessage = consumedMessages.find(
      (m) => m.topic === CARD_REQUESTED_DLQ_TOPIC && m.value.source === requestId,
    );
    expect(dlqMessage).toBeDefined();
    expect(dlqMessage?.key).toBe(requestId);

    const data = dlqMessage?.value.data as {
      requestId: string;
      documentNumber: string;
      originalPayload: unknown;
      error: { reason: string; attempts: number };
    };
    expect(dlqMessage?.value).toMatchObject({
      id: 2,
      type: CARD_REQUESTED_DLQ_TOPIC,
      source: requestId,
    });
    expect(data.requestId).toBe(requestId);
    expect(data.documentNumber).toBe(documentNumber);
    expect(data.originalPayload).toEqual(event.data);
    expect(data.error.attempts).toBe(3);
    expect(typeof data.error.reason).toBe('string');
    expect(data.error.reason.length).toBeGreaterThan(0);

    // No debe haber un evento de emisión para este requestId.
    expect(
      consumedMessages.some((m) => m.topic === CARDS_ISSUED_TOPIC && m.value.source === requestId),
    ).toBe(false);

    const row = await repository.findByRequestId(requestId);
    expect(row?.status).toBe('failed');
    expect(row?.card).toBeNull();
  });
});
