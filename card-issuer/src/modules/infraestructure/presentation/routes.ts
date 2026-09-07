import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CardRequestController } from './card-request.controller';
import { CardRequestApplication } from '../../application/card-request.application';

export interface BuildRoutesOptions {
  application: CardRequestApplication;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export function buildRoutes(options: BuildRoutesOptions): Router {
  const { application, rateLimitWindowMs, rateLimitMax } = options;
  const controller = new CardRequestController(application);
  const router = Router();

  const issueLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const statusLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax * 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/cards/issue', issueLimiter, controller.issue.bind(controller));
  router.get('/cards', statusLimiter, controller.list.bind(controller));
  router.get('/cards/:requestId', statusLimiter, controller.getStatus.bind(controller));
  
  return router;
}
