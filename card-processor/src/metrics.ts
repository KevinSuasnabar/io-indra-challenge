import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const cardProcessingRequestsReceivedTotal = new Counter({
  name: 'card_processor_requests_received_total',
  help: 'Total number of request events received from io.card.requested.v1',
  registers: [metricsRegistry],
});

export const cardsIssuedTotal = new Counter({
  name: 'card_processor_cards_issued_total',
  help: 'Total number of cards issued successfully',
  registers: [metricsRegistry],
});

export const cardProcessingRetriesTotal = new Counter({
  name: 'card_processor_retries_total',
  help: 'Total number of retries performed due to a transient failure of the external approval simulator',
  registers: [metricsRegistry],
});

export const cardProcessingDlqMessagesTotal = new Counter({
  name: 'card_processor_dlq_messages_total',
  help: 'Total number of messages published to io.card.requested.v1.dlq, by reason',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const cardProcessingIdempotentSkipsTotal = new Counter({
  name: 'card_processor_idempotent_skips_total',
  help: 'Total number of events skipped because they were already processed (idempotency by requestId)',
  registers: [metricsRegistry],
});

export const cardProcessingDurationSeconds = new Histogram({
  name: 'card_processor_processing_duration_seconds',
  help: 'End-to-end processing duration of the ProcessCardIssuance use case, in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 15],
  registers: [metricsRegistry],
});
