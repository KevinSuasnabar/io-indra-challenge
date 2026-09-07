import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const cardIssuanceRequestsReceivedTotal = new Counter({
  name: 'card_issuer_requests_received_total',
  help: 'Total number of requests received on POST /cards/issue',
  registers: [metricsRegistry],
});

export const cardIssuanceRequestsAcceptedTotal = new Counter({
  name: 'card_issuer_requests_accepted_total',
  help: 'Total number of requests accepted (201) and published to Kafka',
  registers: [metricsRegistry],
});

export const cardIssuanceRequestsRejectedTotal = new Counter({
  name: 'card_issuer_requests_rejected_total',
  help: 'Total number of rejected requests, by reason',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const cardIssuanceRequestDurationSeconds = new Histogram({
  name: 'card_issuer_request_duration_seconds',
  help: 'Duration of POST /cards/issue requests, in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const cardStatusRequestsTotal = new Counter({
  name: 'card_issuer_status_requests_total',
  help: 'Total number of requests to GET /cards/:requestId, for result',
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});

export const cardListRequestsTotal = new Counter({
  name: 'card_issuer_list_requests_total',
  help: 'Total number of requests to GET /cards, by result',
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});
