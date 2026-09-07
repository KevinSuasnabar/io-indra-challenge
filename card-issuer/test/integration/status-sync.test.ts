import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Kafka, Producer } from 'kafkajs';
import { createApp } from '../../src/app';
import { KafkaBootstrap } from '../../src/bootstrap/kafka.bootstrap';
import { openCardRequestsDatabase } from '../../src/bootstrap/database.bootstrap';
import { CardRequestApplication } from '../../src/modules/application/card-request.application';
import { ProducerService } from '../../src/core/services/producer.service';
import { ConsumerService } from '../../src/core/services/consumer.service';
import {
  CARD_REQUESTED_TOPIC,
  CARDS_ISSUED_TOPIC,
  CARD_REQUESTED_DLQ_TOPIC,
} from '../../src/constants/kafka-topics';
import { CardIssuancePayload } from '../../src/modules/domain/card-request';
import { createLogger } from '../../src/logger';
import { startTestKafkaBroker, TestKafkaBroker } from './support/kafka-test-container';
import { waitFor } from './support/wait-for';
import type Database from 'better-sqlite3';
import { CardRequestRepositoryInfrastructure } from '../../src/modules/infraestructure/persistence/card-request.repository.infraestructure';

jest.setTimeout(120_000);

function buildPayload(documentNumber: string): CardIssuancePayload {
  return {
    customer: {
      documentType: 'DNI',
      documentNumber,
      fullName: 'Jose Peréz',
      age: 25,
      email: 'joseperez@example.com',
    },
    product: { type: 'VISA', currency: 'PEN' },
    forceError: false,
  };
}

describe('card-issuer: status sync via io.card.requested.v1.dlq (integration: real Kafka via Testcontainers)', () => {
  let broker: TestKafkaBroker;
  let baseUrl: string;
  let server: Server;
  let db: Database.Database;
  let repository: CardRequestRepositoryInfrastructure;
  let producerService: ProducerService;
  let consumerService: ConsumerService;
  let testProducer: Producer;

  beforeAll(async () => {
    broker = await startTestKafkaBroker();

    await new KafkaBootstrap().initialize({
      brokers: [broker.bootstrapServers],
      clientId: 'card-issuer-status-sync-test',
    });
    const kafka: Kafka = KafkaBootstrap.getInstanceKafka();

    const adminClient = kafka.admin();
    await adminClient.connect();
    await adminClient.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: CARD_REQUESTED_TOPIC, numPartitions: 1, replicationFactor: 1 },
        { topic: CARDS_ISSUED_TOPIC, numPartitions: 1, replicationFactor: 1 },
        { topic: CARD_REQUESTED_DLQ_TOPIC, numPartitions: 1, replicationFactor: 1 },
      ],
    });
    await adminClient.disconnect();

    const logger = createLogger('silent');

    producerService = new ProducerService(logger);
    await producerService.connect();

    db = openCardRequestsDatabase(':memory:');
    repository = new CardRequestRepositoryInfrastructure(db);
    const application = new CardRequestApplication(repository, producerService);

    consumerService = new ConsumerService(repository, logger, 'card-issuer-status-sync-test-group');
    await consumerService.connect();

    const app = createApp({
      application,
      eventPublisher: producerService,
      logger,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1000,
      corsAllowedOrigins: ['http://localhost:5173'],
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    testProducer = kafka.producer();
    await testProducer.connect();
  });

  afterAll(async () => {
    await testProducer?.disconnect();
    await consumerService?.disconnect();
    await producerService?.disconnect();
    db?.close();
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    await broker?.stop();
  });

  it('moves the row to failed when receiving a DLQ event, and allows a new POST /cards/issue (201, not 409) for the same documentNumber', async () => {
    const documentNumber = '40000001';
    const payload = buildPayload(documentNumber);

    const firstResponse = await fetch(`${baseUrl}/cards/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(firstResponse.status).toBe(201);
    const firstBody = (await firstResponse.json()) as { requestId: string; status: string };

    const rejectedWhilePending = await fetch(`${baseUrl}/cards/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(rejectedWhilePending.status).toBe(409);

    const dlqEvent = {
      id: 2,
      source: firstBody.requestId,
      type: CARD_REQUESTED_DLQ_TOPIC,
      data: {
        requestId: firstBody.requestId,
        documentNumber,
        originalPayload: payload,
        error: { reason: 'Simulated external service failure', attempts: 3 },
      },
    };

    await testProducer.send({
      topic: CARD_REQUESTED_DLQ_TOPIC,
      messages: [{ key: documentNumber, value: JSON.stringify(dlqEvent) }],
    });

    await waitFor(async () => {
      const row = await repository.findByDocumentNumber(documentNumber);
      return row?.status === 'failed';
    });

    const row = await repository.findByDocumentNumber(documentNumber);
    expect(row?.status).toBe('failed');
    expect(row?.requestId).toBe(firstBody.requestId);

    const retryResponse = await fetch(`${baseUrl}/cards/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(retryResponse.status).toBe(201);
    const retryBody = (await retryResponse.json()) as { requestId: string; status: string };
    expect(retryBody.status).toBe('pending');
    expect(retryBody.requestId).not.toBe(firstBody.requestId);

    const rowAfterRetry = await repository.findByDocumentNumber(documentNumber);
    expect(rowAfterRetry?.status).toBe('pending');
    expect(rowAfterRetry?.requestId).toBe(retryBody.requestId);
  });
});
