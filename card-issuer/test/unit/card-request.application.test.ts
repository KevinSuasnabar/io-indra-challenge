import { CardRequestApplication } from '../../src/modules/application/card-request.application';
import { CardRequestRepository } from '../../src/modules/domain/ports/card-request-repository.port';
import { CardRequestEventPublisher } from '../../src/modules/domain/ports/card-request-event-publisher.port';
import { CardIssuancePayload, CardRequest } from '../../src/modules/domain/card-request';
import { DuplicateCardRequestError } from '../../src/modules/domain/errors';
import { CARD_REQUESTED_TOPIC } from '../../src/constants/kafka-topics';
import { CardRequestStatusEnum } from '../../src/constants/card-request-status.enum';

function buildPayload(): CardIssuancePayload {
  return {
    customer: {
      documentType: 'DNI',
      documentNumber: '11654321',
      fullName: 'Jose Peréz',
      age: 25,
      email: 'joseperez@example.com',
    },
    product: { type: 'VISA', currency: 'PEN' },
    forceError: false,
  };
}

function buildExistingRequest(overrides: Partial<CardRequest> = {}): CardRequest {
  return {
    requestId: 'previous-request-id',
    documentNumber: '11654321',
    status: CardRequestStatusEnum.PENDING,
    payload: buildPayload(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CardRequestApplication', () => {
  let repository: jest.Mocked<CardRequestRepository>;
  let publisher: jest.Mocked<CardRequestEventPublisher>;
  let fixedRequestId: string;
  let application: CardRequestApplication;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = {
      save: jest.fn(),
      findByDocumentNumber: jest.fn(),
      retryFailedRequest: jest.fn(),
      updateStatusByRequestId: jest.fn(),
    };
    repository.findByDocumentNumber.mockResolvedValue(null);
    publisher = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      isConnected: jest.fn(),
      publish: jest.fn(),
    };
    fixedRequestId = 'a097d1e9-493f-4d31-a964-b408ab54645c';
    application = new CardRequestApplication(repository, publisher, () => fixedRequestId);
  });

  it('persists the request as pending and publishes the event with the correct contract', async () => {
    repository.save.mockResolvedValue(undefined);
    publisher.publish.mockResolvedValue(undefined);

    const payload = buildPayload();
    const result = await application.execute(payload);

    expect(result).toEqual({ requestId: fixedRequestId, status: 'pending' });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: fixedRequestId,
        documentNumber: payload.customer.documentNumber,
        status: 'pending',
        payload,
      }),
    );

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      {
        id: 1,
        source: fixedRequestId,
        type: CARD_REQUESTED_TOPIC,
        data: payload,
      },
      payload.customer.documentNumber,
      CARD_REQUESTED_TOPIC,
    );
  });

  it('saves before publishing', async () => {
    const callOrder: string[] = [];
    repository.save.mockImplementation(async () => {
      callOrder.push('save');
    });
    publisher.publish.mockImplementation(async () => {
      callOrder.push('publish');
    });

    await application.execute(buildPayload());

    expect(callOrder).toEqual(['save', 'publish']);
  });

  it('propagates DuplicateCardRequestError without publishing when the repository detects a duplicate', async () => {
    repository.save.mockRejectedValue(new DuplicateCardRequestError('11654321'));

    await expect(application.execute(buildPayload())).rejects.toBeInstanceOf(
      DuplicateCardRequestError,
    );

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('generates a different requestId on each call when using the default generator', async () => {
    repository.save.mockResolvedValue(undefined);
    publisher.publish.mockResolvedValue(undefined);
    const defaultApplication = new CardRequestApplication(repository, publisher);

    const first = await defaultApplication.execute(buildPayload());
    const second = await defaultApplication.execute({
      ...buildPayload(),
      customer: { ...buildPayload().customer, documentNumber: '11654322' },
    });

    expect(first.requestId).not.toEqual(second.requestId);
  });

  it('retries via retryFailedRequest and publishes the event when a previous row is failed', async () => {
    repository.findByDocumentNumber.mockResolvedValue(
      buildExistingRequest({ status: CardRequestStatusEnum.FAILED }),
    );
    repository.retryFailedRequest.mockResolvedValue(true);
    publisher.publish.mockResolvedValue(undefined);

    const payload = buildPayload();
    const result = await application.execute(payload);

    expect(result).toEqual({ requestId: fixedRequestId, status: 'pending' });
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.retryFailedRequest).toHaveBeenCalledTimes(1);
    expect(repository.retryFailedRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: fixedRequestId,
        documentNumber: payload.customer.documentNumber,
        status: 'pending',
        payload,
      }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it.each([CardRequestStatusEnum.PENDING, CardRequestStatusEnum.ISSUED])(
    'rejects with DuplicateCardRequestError without writing when a previous row is %s',
    async (status) => {
      repository.findByDocumentNumber.mockResolvedValue(buildExistingRequest({ status }));

      await expect(application.execute(buildPayload())).rejects.toBeInstanceOf(
        DuplicateCardRequestError,
      );

      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.retryFailedRequest).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    },
  );

  it('rejects with DuplicateCardRequestError and does not publish when retryFailedRequest returns false (lost race)', async () => {
    repository.findByDocumentNumber.mockResolvedValue(
      buildExistingRequest({ status: CardRequestStatusEnum.FAILED }),
    );
    repository.retryFailedRequest.mockResolvedValue(false);

    await expect(application.execute(buildPayload())).rejects.toBeInstanceOf(
      DuplicateCardRequestError,
    );

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
