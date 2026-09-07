import { randomUUID } from 'node:crypto';
import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { Logger } from './logger';
import { metricsRegistry } from './metrics';
import { CardIssuanceEventPublisher } from './modules/domain/ports/card-issuance-event-publisher.port';

export interface CreateAppOptions {
  eventPublisher: CardIssuanceEventPublisher;
  consumer: { isConnected(): Promise<boolean> };
  logger: Logger;
}

export function createApp(options: CreateAppOptions): Express {
  const { eventPublisher, consumer, logger } = options;

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/metrics',
      },
    }),
  );

  app.get('/health', (_req, res) => {
    void (async () => {
      const [producerOk, consumerOk] = await Promise.all([
        eventPublisher.isConnected(),
        consumer.isConnected(),
      ]);
      const kafkaOk = producerOk && consumerOk;
      res.status(kafkaOk ? 200 : 503).json({
        status: kafkaOk ? 'ok' : 'degraded',
        kafka: {
          producer: producerOk ? 'connected' : 'disconnected',
          consumer: consumerOk ? 'connected' : 'disconnected',
        },
      });
    })();
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    req.log?.error({ err }, 'Unhandled error processing the request');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}
