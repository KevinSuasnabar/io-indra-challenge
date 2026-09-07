import pino from 'pino';
import { ConsumerService } from '../../src/core/services/consumer.service';
import { ProcessCardIssuanceApplication } from '../../src/modules/application/card-issuance.application';
import { CardIssuanceEventPublisher } from '../../src/modules/domain/ports/card-issuance-event-publisher.port';
import { CARD_REQUESTED_DLQ_TOPIC } from '../../src/constants/kafka-topics';

describe('ConsumerService (card-processor)', () => {
  let application: jest.Mocked<Pick<ProcessCardIssuanceApplication, 'execute'>>;
  let publisher: jest.Mocked<CardIssuanceEventPublisher>;
  let consumerService: ConsumerService;

  function validRawEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      type: 'io.card.requested.v1',
      data: {
        customer: {
          documentType: 'DNI',
          documentNumber: '11654321',
          fullName: 'Jose Peréz',
          age: 25,
          email: 'joseperez@example.com',
        },
        product: { type: 'VISA', currency: 'PEN' },
        forceError: false,
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    application = { execute: jest.fn().mockResolvedValue(undefined) };
    publisher = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      isConnected: jest.fn(),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    consumerService = new ConsumerService(
      application as unknown as ProcessCardIssuanceApplication,
      publisher,
      pino({ level: 'silent' }),
      'test-group',
    );
  });

  it('delegates to the use case when the event has a valid schema', async () => {
    const event = validRawEvent();

    await consumerService.handleMessage(Buffer.from(JSON.stringify(event)));

    expect(application.execute).toHaveBeenCalledTimes(1);
    expect(application.execute).toHaveBeenCalledWith(event);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('permanent error: publishes straight to the DLQ (attempts: 0) when the message is not valid JSON, without invoking the use case', async () => {
    await consumerService.handleMessage(Buffer.from('{this is not json'));

    expect(application.execute).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const [dlqEvent, key, topic] = publisher.publish.mock.calls[0];
    expect(topic).toBe(CARD_REQUESTED_DLQ_TOPIC);
    expect(typeof key).toBe('string');
    expect((dlqEvent as { data: { error: { attempts: number } } }).data.error.attempts).toBe(0);
  });

  it('permanent error: publishes to the DLQ when the event does not match the expected schema, using the recovered source', async () => {
    const malformed = validRawEvent({
      data: { customer: { documentNumber: '11654321' } }, // faltan campos requeridos
    });

    await consumerService.handleMessage(Buffer.from(JSON.stringify(malformed)));

    expect(application.execute).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const [dlqEvent, key, topic] = publisher.publish.mock.calls[0];
    expect(topic).toBe(CARD_REQUESTED_DLQ_TOPIC);
    expect(key).toBe('a097d1e9-493f-4d31-a964-b408ab54645c');
    expect((dlqEvent as { source: string }).source).toBe('a097d1e9-493f-4d31-a964-b408ab54645c');
    expect((dlqEvent as { data: { error: { attempts: number } } }).data.error.attempts).toBe(0);
  });

  it('permanent error with no recoverable source: generates a synthetic requestId for the DLQ event', async () => {
    await consumerService.handleMessage(Buffer.from(JSON.stringify({ foo: 'bar' })));

    expect(application.execute).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const [dlqEvent] = publisher.publish.mock.calls[0];
    expect(typeof (dlqEvent as { source: string }).source).toBe('string');
    expect((dlqEvent as { source: string }).source.length).toBeGreaterThan(0);
  });

  it('empty message (null): does not invoke the use case, publishes to the DLQ', async () => {
    await consumerService.handleMessage(null);

    expect(application.execute).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('never rethrows, even if publishing the DLQ event fails for an invalid schema', async () => {
    publisher.publish.mockRejectedValue(new Error('broker down'));

    await expect(
      consumerService.handleMessage(Buffer.from('{this is not json')),
    ).resolves.toBeUndefined();
  });
});
