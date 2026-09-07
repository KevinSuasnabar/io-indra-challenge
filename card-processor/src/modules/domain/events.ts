import { CARDS_ISSUED_TOPIC, CARD_REQUESTED_DLQ_TOPIC } from '../../constants/kafka-topics';
import { CardDetails } from './card-issuance';

export interface CardsIssuedEventData {
  requestId: string;
  documentNumber: string;
  card: CardDetails;
  status: 'issued';
}

export interface CardsIssuedEvent {
  id: 2;
  source: string;
  type: typeof CARDS_ISSUED_TOPIC;
  data: CardsIssuedEventData;
}

export interface DlqEventError {
  reason: string;
  attempts: number;
}

export interface CardRequestedDlqEventData {
  requestId: string;
  documentNumber?: string;
  originalPayload: unknown;
  error: DlqEventError;
}

export interface CardRequestedDlqEvent {
  id: 2;
  source: string;
  type: typeof CARD_REQUESTED_DLQ_TOPIC;
  data: CardRequestedDlqEventData;
}

export function buildCardsIssuedEvent(params: {
  requestId: string;
  documentNumber: string;
  card: CardDetails;
}): CardsIssuedEvent {
  return {
    id: 2,
    source: params.requestId,
    type: CARDS_ISSUED_TOPIC,
    data: {
      requestId: params.requestId,
      documentNumber: params.documentNumber,
      card: params.card,
      status: 'issued',
    },
  };
}

export function buildCardRequestedDlqEvent(params: {
  requestId: string;
  documentNumber?: string;
  originalPayload: unknown;
  reason: string;
  attempts: number;
}): CardRequestedDlqEvent {
  return {
    id: 2,
    source: params.requestId,
    type: CARD_REQUESTED_DLQ_TOPIC,
    data: {
      requestId: params.requestId,
      documentNumber: params.documentNumber,
      originalPayload: params.originalPayload,
      error: { reason: params.reason, attempts: params.attempts },
    },
  };
}
