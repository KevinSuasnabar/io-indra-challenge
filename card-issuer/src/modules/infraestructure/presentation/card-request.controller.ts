import { Request, Response } from 'express';
import { cardIssuanceRequestSchema } from './schemas/card-issuance.schema';
import { CardRequestApplication } from '../../application/card-request.application';
import { CardRequestNotFoundError, DuplicateCardRequestError ,InvalidCursorError, } from '../../domain/errors';
import {
  cardIssuanceRequestsReceivedTotal,
  cardIssuanceRequestsAcceptedTotal,
  cardIssuanceRequestsRejectedTotal,
  cardIssuanceRequestDurationSeconds,
  cardStatusRequestsTotal,
  cardListRequestsTotal,
} from '../../../metrics';
import { cardRequestIdParamSchema } from './schemas/card-request-id.schema';
import { cardRequestListQuerySchema } from './schemas/card-request-list.schema';

export class CardRequestController {
  constructor(private readonly application: CardRequestApplication) {}

  async issue(req: Request, res: Response): Promise<void> {
    cardIssuanceRequestsReceivedTotal.inc();
    const endTimer = cardIssuanceRequestDurationSeconds.startTimer();

    const parseResult = cardIssuanceRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      cardIssuanceRequestsRejectedTotal.inc({ reason: 'validation' });
      endTimer();
      res.status(400).json({
        message: 'Invalid payload',
        issues: parseResult.error.issues,
      });
      return;
    }

    try {
      const result = await this.application.execute(parseResult.data);
      cardIssuanceRequestsAcceptedTotal.inc();
      endTimer();
      req.log.info({ source: result.requestId }, 'Card issuance request created');
      res.status(201).json(result);
    } catch (error) {
      endTimer();
      if (error instanceof DuplicateCardRequestError) {
        cardIssuanceRequestsRejectedTotal.inc({ reason: 'duplicate' });
        req.log.warn(
          { documentNumber: parseResult.data.customer.documentNumber },
          'Request rejected: a card already exists for this document',
        );
        res.status(409).json({ message: error.message });
        return;
      }
      // Cualquier otro error se delega al manejador global (app.ts)
      // (Express 5 reenvía automáticamente los rechazos de handlers async)
      throw error;
    }
  }

  async getStatus(req: Request, res: Response): Promise<void> {
    const parseResult = cardRequestIdParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      cardStatusRequestsTotal.inc({ result: 'invalid_request_id' });
      res.status(400).json({
        message: 'requestId inválido',
        issues: parseResult.error.issues,
      });
      return;
    }
  
    try {
      const result = await this.application.getStatus(parseResult.data.requestId);
      cardStatusRequestsTotal.inc({ result: 'found' });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof CardRequestNotFoundError) {
        cardStatusRequestsTotal.inc({ result: 'not_found' });
        res.status(404).json({ message: error.message });
        return;
      }
      throw error;
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    const parseResult = cardRequestListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      cardListRequestsTotal.inc({ result: 'invalid_query' });
      res.status(400).json({
        message: 'Invalid query parameters',
        issues: parseResult.error.issues,
      });
      return;
    }
  
    try {
      const result = await this.application.listRecent({
        limit: parseResult.data.limit,
        cursor: parseResult.data.cursor ?? null,
      });
      cardListRequestsTotal.inc({ result: 'ok' });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        cardListRequestsTotal.inc({ result: 'invalid_cursor' });
        res.status(400).json({ message: error.message });
        return;
      }
      throw error;
    }
  }
}
