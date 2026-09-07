import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Admin, Consumer, Kafka } from 'kafkajs';
import { createApp } from '../../src/app';
import { KafkaBootstrap } from '../../src/bootstrap/kafka.bootstrap';
import { openCardRequestsDatabase } from '../../src/bootstrap/database.bootstrap';
import { CardRequestApplication } from '../../src/modules/application/card-request.application';
import { ProducerService } from '../../src/core/services/producer.service';
import { CARD_REQUESTED_TOPIC } from '../../src/constants/kafka-topics';
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

interface ConsumedMessage {
  key: string | null;
  value: Record<string, unknown>;
}

describe('POST /cards/issue (integration: real Express + real Kafka via Testcontainers)', () => {
  let broker: TestKafkaBroker;
  let baseUrl: string;
  let server: Server;
  let db: Database.Database;
  let consumedMessages: ConsumedMessage[];
  let consumer: Consumer;
  let adminClient: Admin;
  let producerService: ProducerService;

  beforeAll(async () => {
    broker = await startTestKafkaBroker();

    await new KafkaBootstrap().initialize({
      brokers: [broker.bootstrapServers],
      clientId: 'card-issuer-test',
    });
    const kafka: Kafka = KafkaBootstrap.getInstanceKafka();

    adminClient = kafka.admin();
    await adminClient.connect();
    await adminClient.createTopics({
      waitForLeaders: true,
      topics: [{ topic: CARD_REQUESTED_TOPIC, numPartitions: 1, replicationFactor: 1 }],
    });

    const logger = createLogger('silent');

    producerService = new ProducerService(logger);
    await producerService.connect();

    db = openCardRequestsDatabase(':memory:');
    const repository = new CardRequestRepositoryInfrastructure(db);
    const application = new CardRequestApplication(repository, producerService);

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

    consumedMessages = [];
    consumer = kafka.consumer({ groupId: 'card-issuer-integration-test' });
    await consumer.connect();
    await consumer.subscribe({ topic: CARD_REQUESTED_TOPIC, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message }) => {
        consumedMessages.push({
          key: message.key ? message.key.toString() : null,
          value: JSON.parse(message.value?.toString() ?? '{}') as Record<string, unknown>,
        });
      },
    });
  });

  afterAll(async () => {
    await consumer?.disconnect();
    await producerService?.disconnect();
    await adminClient?.disconnect();
    db?.close();
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    await broker?.stop();
  });

  it('publishes the event on io.card.requested.v1 with the CloudEvents contract and key=documentNumber', async () => {
    const documentNumber = '30000001';
    const payload = buildPayload(documentNumber);

    const response = await fetch(`${baseUrl}/cards/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { requestId: string; status: string };
    expect(body.status).toBe('pending');
    expect(typeof body.requestId).toBe('string');

    await waitFor(() => consumedMessages.some((m) => m.key === documentNumber));

    const message = consumedMessages.find((m) => m.key === documentNumber);
    expect(message).toBeDefined();
    expect(message?.value).toEqual({
      id: 1,
      source: body.requestId,
      type: 'io.card.requested.v1',
      data: payload,
    });
  });

  it('given two concurrent requests with the same documentNumber, only one persists (201) and the other is rejected (409)', async () => {
    const documentNumber = '30000002';
    const payload = buildPayload(documentNumber);

    const postIssueRequest = () =>
      fetch(`${baseUrl}/cards/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    const [responseA, responseB] = await Promise.all([postIssueRequest(), postIssueRequest()]);

    const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    await waitFor(() => consumedMessages.some((m) => m.key === documentNumber));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(consumedMessages.filter((m) => m.key === documentNumber)).toHaveLength(1);
  });
});
