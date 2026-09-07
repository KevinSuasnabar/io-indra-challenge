import pino from 'pino';
import { ConsumerService } from '../../src/core/services/consumer.service';
import { CardRequestRepository } from '../../src/modules/domain/ports/card-request-repository.port';
import { CardRequestStatusEnum } from '../../src/constants/card-request-status.enum';
import { CARDS_ISSUED_TOPIC, CARD_REQUESTED_DLQ_TOPIC } from '../../src/constants/kafka-topics';

describe('ConsumerService', () => {
  let repository: jest.Mocked<CardRequestRepository>;
  let consumerService: ConsumerService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = {
      save: jest.fn(),
      findByDocumentNumber: jest.fn(),
      retryFailedRequest: jest.fn(),
      updateStatusByRequestId: jest.fn(),
    };
    consumerService = new ConsumerService(repository, pino({ level: 'silent' }), 'test-group');
  });

  it('syncs to ISSUED when receiving an io.cards.issued.v1 event', async () => {
    const event = {
      id: 2,
      source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      type: CARDS_ISSUED_TOPIC,
      data: { requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c' },
    };

    await consumerService.handleMessage(Buffer.from(JSON.stringify(event)));

    expect(repository.updateStatusByRequestId).toHaveBeenCalledTimes(1);
    expect(repository.updateStatusByRequestId).toHaveBeenCalledWith(
      event.source,
      CardRequestStatusEnum.ISSUED,
      expect.any(String),
    );
  });

  it('syncs to FAILED when receiving an io.card.requested.v1.dlq event', async () => {
    const event = {
      id: 2,
      source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      type: CARD_REQUESTED_DLQ_TOPIC,
      data: { requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c' },
    };

    await consumerService.handleMessage(Buffer.from(JSON.stringify(event)));

    expect(repository.updateStatusByRequestId).toHaveBeenCalledTimes(1);
    expect(repository.updateStatusByRequestId).toHaveBeenCalledWith(
      event.source,
      CardRequestStatusEnum.FAILED,
      expect.any(String),
    );
  });

  it('does not call the repository when the message is not valid JSON', async () => {
    await consumerService.handleMessage(Buffer.from('{esto no es json'));

    expect(repository.updateStatusByRequestId).not.toHaveBeenCalled();
  });

  it('does not call the repository when the event lacks source/type in the expected shape', async () => {
    await consumerService.handleMessage(Buffer.from(JSON.stringify({ id: 2, foo: 'bar' })));

    expect(repository.updateStatusByRequestId).not.toHaveBeenCalled();
  });

  it('does not call the repository when the type is not one of the two recognized values', async () => {
    const event = { source: 'req-1', type: 'io.something.else.v1' };

    await consumerService.handleMessage(Buffer.from(JSON.stringify(event)));

    expect(repository.updateStatusByRequestId).not.toHaveBeenCalled();
  });

  it('does not call the repository when the message is empty (null)', async () => {
    await consumerService.handleMessage(null);

    expect(repository.updateStatusByRequestId).not.toHaveBeenCalled();
  });

  it('logs the error and continues (does not rethrow) when the repository fails to sync', async () => {
    const event = {
      source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      type: CARDS_ISSUED_TOPIC,
    };
    repository.updateStatusByRequestId.mockRejectedValue(new Error('DB down'));

    await expect(
      consumerService.handleMessage(Buffer.from(JSON.stringify(event))),
    ).resolves.toBeUndefined();
  });
});
