import { CardRequestStatusEnum } from '../../../constants/card-request-status.enum';
import { CardRequest, CardRequestListResult } from '../card-request';

export type CardRequestRepository = {
  save(request: CardRequest): Promise<void>;
  findByDocumentNumber(documentNumber: string): Promise<CardRequest | null>;
  retryFailedRequest(request: CardRequest): Promise<boolean>;
  updateStatusByRequestId(
    requestId: string,
    status: CardRequestStatusEnum,
    updatedAt: string,
  ): Promise<void>;
  findByRequestId(requestId: string): Promise<CardRequest | null>;
  listRecent(options: { limit: number; cursor: string | null }): Promise<CardRequestListResult>;
  markAsFailed(                                                                                     // ← nuevo
    requestId: string,
    reason: string,
    attempts: number,
    updatedAt: string,
  ): Promise<void>;
};
