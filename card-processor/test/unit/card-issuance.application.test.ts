import pino from 'pino';
import { ProcessCardIssuanceApplication } from '../../src/modules/application/card-issuance.application';
import { CardIssuanceRepository } from '../../src/modules/domain/ports/card-issuance-repository.port';
import { CardIssuanceEventPublisher } from '../../src/modules/domain/ports/card-issuance-event-publisher.port';
import { CardRequestedEvent } from '../../src/modules/infraestructure/schemas/card-requested-event.schema';
import {
  DuplicateCardIssuanceError,
  TransientApprovalError,
} from '../../src/modules/domain/errors';
import { CARDS_ISSUED_TOPIC, CARD_REQUESTED_DLQ_TOPIC } from '../../src/constants/kafka-topics';
import { CardProcessingStatusEnum } from '../../src/constants/card-processing-status.enum';

const noopDelay = async (): Promise<void> => {};

function buildEvent(overrides: Partial<CardRequestedEvent['data']> = {}): CardRequestedEvent {
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
      ...overrides,
    },
  };
}

const FIXED_CARD = { number: '4111111111111111', expiry: '12/30', cvv: '123' };

describe('ProcessCardIssuanceApplication', () => {
  let repository: jest.Mocked<CardIssuanceRepository>;
  let publisher: jest.Mocked<CardIssuanceEventPublisher>;
  let logger: pino.Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = {
      findByRequestId: jest.fn(),
      save: jest.fn(),
    };
    repository.findByRequestId.mockResolvedValue(null);
    repository.save.mockResolvedValue(undefined);

    publisher = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      isConnected: jest.fn(),
      publish: jest.fn().mockResolvedValue(undefined),
    };

    logger = pino({ level: 'silent' });
  });

  // --- Idempotency -------------------------------------------------------

  it('idempotency: if a row already exists for the requestId, does not reprocess or republish', async () => {
    repository.findByRequestId.mockResolvedValue({
      requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      documentNumber: '11654321',
      card: FIXED_CARD,
      status: CardProcessingStatusEnum.ISSUED,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const simulateExternalApproval = jest.fn();
    const generateCardDetails = jest.fn();
    const application = new ProcessCardIssuanceApplication(repository, publisher, logger, {
      simulateExternalApproval,
      generateCardDetails,
      delayFn: noopDelay,
    });

    await application.execute(buildEvent());

    expect(repository.findByRequestId).toHaveBeenCalledWith('a097d1e9-493f-4d31-a964-b408ab54645c');
    expect(simulateExternalApproval).not.toHaveBeenCalled();
    expect(generateCardDetails).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  // --- Happy path ---------------------------------------------------------

  it('success: persists the card as issued and publishes io.cards.issued.v1 with the exact contract', async () => {
    const simulateExternalApproval = jest.fn().mockResolvedValue(undefined);
    const generateCardDetails = jest.fn().mockReturnValue(FIXED_CARD);

    const application = new ProcessCardIssuanceApplication(repository, publisher, logger, {
      simulateExternalApproval,
      generateCardDetails,
      delayFn: noopDelay,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    await application.execute(buildEvent());

    expect(simulateExternalApproval).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith({
      requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      documentNumber: '11654321',
      card: FIXED_CARD,
      status: CardProcessingStatusEnum.ISSUED,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      {
        id: 2,
        source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
        type: CARDS_ISSUED_TOPIC,
        data: {
          requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
          documentNumber: '11654321',
          card: FIXED_CARD,
          status: 'issued',
        },
      },
      'a097d1e9-493f-4d31-a964-b408ab54645c',
      CARDS_ISSUED_TOPIC,
    );
  });

  it('success after a transient failure: retries approval and ends up issuing the card', async () => {
    const simulateExternalApproval = jest
      .fn()
      .mockRejectedValueOnce(new TransientApprovalError())
      .mockResolvedValueOnce(undefined);
    const generateCardDetails = jest.fn().mockReturnValue(FIXED_CARD);

    const application = new ProcessCardIssuanceApplication(repository, publisher, logger, {
      simulateExternalApproval,
      generateCardDetails,
      delayFn: noopDelay,
    });

    await application.execute(buildEvent());

    expect(simulateExternalApproval).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CardProcessingStatusEnum.ISSUED }),
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: CARDS_ISSUED_TOPIC }),
      expect.any(String),
      CARDS_ISSUED_TOPIC,
    );
  });

  // --- Failure / DLQ  -------------------------------------------------

  it('retries exhausted: persists as failed and publishes io.card.requested.v1.dlq with reason/attempts/originalPayload', async () => {
    const simulateExternalApproval = jest
      .fn()
      .mockRejectedValue(new TransientApprovalError('simulated failure'));
    const generateCardDetails = jest.fn();

    const application = new ProcessCardIssuanceApplication(repository, publisher, logger, {
      simulateExternalApproval,
      generateCardDetails,
      delayFn: noopDelay,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const event = buildEvent({ forceError: true });
    await application.execute(event);

    // 1 intento inicial + 3 reintentos = 4 llamadas totales al simulador.
    expect(simulateExternalApproval).toHaveBeenCalledTimes(4);
    expect(generateCardDetails).not.toHaveBeenCalled();

    expect(repository.save).toHaveBeenCalledWith({
      requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
      documentNumber: '11654321',
      card: null,
      status: CardProcessingStatusEnum.FAILED,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      {
        id: 2,
        source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
        type: CARD_REQUESTED_DLQ_TOPIC,
        data: {
          requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
          documentNumber: '11654321',
          originalPayload: event.data,
          error: { reason: 'simulated failure', attempts: 3 },
        },
      },
      'a097d1e9-493f-4d31-a964-b408ab54645c',
      CARD_REQUESTED_DLQ_TOPIC,
    );
  });

  it('never rethrows, even if publishing the DLQ event fails', async () => {
    const simulateExternalApproval = jest.fn().mockRejectedValue(new TransientApprovalError());
    publisher.publish.mockRejectedValue(new Error('broker down'));

    const application = new ProcessCardIssuanceApplication(repository, publisher, logger, {
      simulateExternalApproval,
      delayFn: noopDelay,
    });

    await expect(application.execute(buildEvent())).resolves.toBeUndefined();
  });

  // --- Idempotencia por UNIQUE --------------------------

  it('if repository.save throws DuplicateCardIssuanceError on the happy path, does not publish a second event', async () => {
    const simulateExternalApproval = jest.fn().mockResolvedValue(undefined);
    const generateCardDetails = jest.fn().mockReturnValue(FIXED_CARD);
    repository.save.mockRejectedValue(
      new DuplicateCardIssuanceError('a097d1e9-493f-4d31-a964-b408ab54645c'),
    );

    const application = new ProcessCardIssuanceApplication(repository, publisher, logger, {
      simulateExternalApproval,
      generateCardDetails,
      delayFn: noopDelay,
    });

    await application.execute(buildEvent());

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
