import { randomUUID } from 'node:crypto';
import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { buildRoutes } from './modules/infraestructure/presentation/routes';
import { CardRequestApplication } from './modules/application/card-request.application';
import { CardRequestEventPublisher } from './modules/domain/ports/card-request-event-publisher.port';
import { Logger } from './logger';
import { metricsRegistry } from './metrics';
import cors from 'cors';

export interface CreateAppOptions {
  application: CardRequestApplication;
  eventPublisher: CardRequestEventPublisher;
  logger: Logger;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  statusSyncConsumer?: { isConnected(): Promise<boolean> };
  corsAllowedOrigins: string[];
}

export function createApp(options: CreateAppOptions): Express {
  const {
    application,
    eventPublisher,
    statusSyncConsumer,
    logger,
    rateLimitWindowMs,
    rateLimitMax,
    corsAllowedOrigins,
  } = options;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: corsAllowedOrigins }));
  app.use(express.json());
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
        statusSyncConsumer ? statusSyncConsumer.isConnected() : Promise.resolve(true),
      ]);
      const kafkaOk = producerOk && consumerOk;
      res.status(kafkaOk ? 200 : 503).json({
        status: kafkaOk ? 'ok' : 'degraded',
        kafka: kafkaOk ? 'connected' : 'disconnected',
      });
    })();
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  app.use(buildRoutes({ application, rateLimitWindowMs, rateLimitMax }));

  // Manejador de errores global: nunca expone stack traces al cliente.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    req.log?.error({ err }, 'Unhandled error processing the request');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}
