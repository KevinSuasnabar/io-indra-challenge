import { randomUUID } from 'node:crypto';
import { CardRequestStatusEnum } from '../../constants/card-request-status.enum';
import { CARD_REQUESTED_TOPIC } from '../../constants/kafka-topics';
import {
  CardIssuancePayload,
  CardRequest,
  CardRequestListResult,
  CardRequestStatus,
} from '../domain/card-request';
import { CardRequestNotFoundError, DuplicateCardRequestError } from '../domain/errors';
import { CardRequestEventPublisher } from '../domain/ports/card-request-event-publisher.port';
import { CardRequestRepository } from '../domain/ports/card-request-repository.port';

export interface RequestCardIssuanceResult {
  requestId: string;
  status: CardRequestStatusEnum.PENDING;
}


export interface CardRequestStatusResult {
  requestId: string;
  documentNumber: string;
  status: CardRequestStatus;
  createdAt: string;
  updatedAt: string;
  failureReason: string | null;
  failureAttempts: number | null;
}


export interface CardRequestedEvent {
  id: 1;
  source: string;
  type: typeof CARD_REQUESTED_TOPIC;
  data: CardIssuancePayload;
}


export class CardRequestApplication {
  constructor(
    private readonly repository: CardRequestRepository,
    private readonly publisher: CardRequestEventPublisher,
    private readonly generateRequestId: () => string = randomUUID,
  ) {}

  async execute(payload: CardIssuancePayload): Promise<RequestCardIssuanceResult> {
    const documentNumber = payload.customer.documentNumber;
    const existingRequest = await this.repository.findByDocumentNumber(documentNumber);

    if (
      existingRequest &&
      (existingRequest.status === CardRequestStatusEnum.PENDING ||
        existingRequest.status === CardRequestStatusEnum.ISSUED)
    ) {
      throw new DuplicateCardRequestError(documentNumber);
    }

    const requestId = this.generateRequestId();
    const now = new Date().toISOString();

    const cardRequest: CardRequest = {
      requestId,
      documentNumber,
      status: CardRequestStatusEnum.PENDING,
      payload,
      createdAt: now,
      updatedAt: now,
      failureReason: null,
      failureAttempts: null,
    };

    if (existingRequest) {
      const retried = await this.repository.retryFailedRequest(cardRequest);
      if (!retried) {
        throw new DuplicateCardRequestError(documentNumber);
      }
    } else {
     
      await this.repository.save(cardRequest);
    }

    const event: CardRequestedEvent = {
      id: 1,
      source: requestId,
      type: CARD_REQUESTED_TOPIC,
      data: payload,
    };

    await this.publisher.publish(event, documentNumber, CARD_REQUESTED_TOPIC);

    return { requestId, status: CardRequestStatusEnum.PENDING };
  }


  async getStatus(requestId: string): Promise<CardRequestStatusResult> {
    const cardRequest = await this.repository.findByRequestId(requestId);

    if (!cardRequest) {
      throw new CardRequestNotFoundError(requestId);
    }

    return {
      requestId: cardRequest.requestId,
      documentNumber: cardRequest.documentNumber,
      status: cardRequest.status,
      createdAt: cardRequest.createdAt,
      updatedAt: cardRequest.updatedAt,
      failureReason: cardRequest.failureReason,
      failureAttempts: cardRequest.failureAttempts,
    };
  }


  async listRecent(options: { limit: number; cursor: string | null }): Promise<CardRequestListResult> {
    return this.repository.listRecent(options);
  }
}
