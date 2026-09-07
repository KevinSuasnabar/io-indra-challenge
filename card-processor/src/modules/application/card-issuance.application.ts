import { CARDS_ISSUED_TOPIC, CARD_REQUESTED_DLQ_TOPIC } from '../../constants/kafka-topics';
import {
  CARD_PROCESSING_BASE_DELAY_MS,
  CARD_PROCESSING_MAX_RETRIES,
} from '../../constants/constants';
import {
  cardProcessingDlqMessagesTotal,
  cardProcessingDurationSeconds,
  cardProcessingIdempotentSkipsTotal,
  cardProcessingRetriesTotal,
  cardsIssuedTotal,
} from '../../metrics';
import { retryWithBackoff, RetryWithBackoffOptions } from '../../core/services/retry-with-backoff';
import { CardRequestedEvent } from '../infraestructure/schemas/card-requested-event.schema';
import { CardDetails, CardIssuance } from '../domain/card-issuance';
import { CardProcessingStatusEnum } from '../../constants/card-processing-status.enum';
import { DuplicateCardIssuanceError } from '../domain/errors';
import { buildCardRequestedDlqEvent, buildCardsIssuedEvent } from '../domain/events';
import { generateCardDetails } from '../domain/card-generator';
import { maskCardForLog } from '../domain/card-masking';
import {
  simulateExternalApproval,
  SimulateExternalApprovalOptions,
} from '../domain/approval-simulator';
import { CardIssuanceEventPublisher } from '../domain/ports/card-issuance-event-publisher.port';
import { CardIssuanceRepository } from '../domain/ports/card-issuance-repository.port';
import { Logger } from '../../logger';

export interface ProcessCardIssuanceDependencies {
  generateCardDetails?: (randomFn?: () => number) => CardDetails;
  simulateExternalApproval?: (options: SimulateExternalApprovalOptions) => Promise<void>;
  delayFn?: (ms: number) => Promise<void>;
  now?: () => string;
}

export class ProcessCardIssuanceApplication {
  private readonly generateCard: (randomFn?: () => number) => CardDetails;
  private readonly approve: (options: SimulateExternalApprovalOptions) => Promise<void>;
  private readonly delayFn?: (ms: number) => Promise<void>;
  private readonly now: () => string;

  constructor(
    private readonly repository: CardIssuanceRepository,
    private readonly publisher: CardIssuanceEventPublisher,
    private readonly logger: Logger,
    dependencies: ProcessCardIssuanceDependencies = {},
  ) {
    this.generateCard = dependencies.generateCardDetails ?? generateCardDetails;
    this.approve = dependencies.simulateExternalApproval ?? simulateExternalApproval;
    this.delayFn = dependencies.delayFn;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(event: CardRequestedEvent): Promise<void> {
    const requestId = event.source;
    const { data } = event;
    const documentNumber = data.customer.documentNumber;
    const endTimer = cardProcessingDurationSeconds.startTimer();

    try {
      const existing = await this.repository.findByRequestId(requestId);
      if (existing) {
        cardProcessingIdempotentSkipsTotal.inc();
        this.logger.info(
          { source: requestId },
          'Request already processed previously, skipping (idempotency by requestId)',
        );
        return;
      }

      this.logger.info({ source: requestId }, 'Processing card issuance request');

      let card: CardDetails;
      try {
        card = await this.approveAndGenerateCard(requestId, data.forceError);
      } catch (error) {
        await this.handleExhaustedRetries(requestId, documentNumber, data, error);
        return;
      }

      await this.persistAndPublishSuccess(requestId, documentNumber, card);
    } catch (error) {
      this.logger.error(
        { err: error, source: requestId },
        'Unexpected error processing the request',
      );
    } finally {
      endTimer();
    }
  }

  private async approveAndGenerateCard(
    requestId: string,
    forceError: boolean,
  ): Promise<CardDetails> {
    const retryOptions: RetryWithBackoffOptions = {
      maxRetries: CARD_PROCESSING_MAX_RETRIES,
      baseDelayMs: CARD_PROCESSING_BASE_DELAY_MS,
      delayFn: this.delayFn,
      onRetry: (retryNumber) => {
        cardProcessingRetriesTotal.inc();
        this.logger.warn(
          { source: requestId, retryNumber },
          'Transient failure of the external approval simulator, retrying',
        );
      },
    };

    return retryWithBackoff(async () => {
      await this.approve({ forceError, delayFn: this.delayFn });
      return this.generateCard();
    }, retryOptions);
  }

  private async persistAndPublishSuccess(
    requestId: string,
    documentNumber: string,
    card: CardDetails,
  ): Promise<void> {
    const timestamp = this.now();
    const record: CardIssuance = {
      requestId,
      documentNumber,
      card,
      status: CardProcessingStatusEnum.ISSUED,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      await this.repository.save(record);
    } catch (error) {
      if (error instanceof DuplicateCardIssuanceError) {
        this.logger.warn(
          { source: requestId },
          'Another process already issued this request (idempotency by UNIQUE), not publishing again',
        );
        return;
      }
      throw error;
    }

    const event = buildCardsIssuedEvent({ requestId, documentNumber, card });
    await this.publisher.publish(event, requestId, CARDS_ISSUED_TOPIC);

    cardsIssuedTotal.inc();
    this.logger.info(
      { source: requestId, card: maskCardForLog(card) },
      'Card issued and event published to io.cards.issued.v1',
    );
  }

  private async handleExhaustedRetries(
    requestId: string,
    documentNumber: string,
    originalPayload: unknown,
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : 'Unknown error processing the request';

    try {
      const timestamp = this.now();
      const record: CardIssuance = {
        requestId,
        documentNumber,
        card: null,
        status: CardProcessingStatusEnum.FAILED,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.repository.save(record);
    } catch (persistError) {
      if (persistError instanceof DuplicateCardIssuanceError) {
        this.logger.warn(
          { source: requestId },
          'A record already existed for this request, not persisting again',
        );
      } else {
        this.logger.error(
          { err: persistError, source: requestId },
          'Error persisting the failure (does not block sending to the DLQ)',
        );
      }
    }

    try {
      const dlqEvent = buildCardRequestedDlqEvent({
        requestId,
        documentNumber,
        originalPayload,
        reason,
        attempts: CARD_PROCESSING_MAX_RETRIES,
      });
      await this.publisher.publish(dlqEvent, requestId, CARD_REQUESTED_DLQ_TOPIC);

      cardProcessingDlqMessagesTotal.inc({ reason: 'retries_exhausted' });
      this.logger.error(
        { source: requestId, attempts: CARD_PROCESSING_MAX_RETRIES, reason },
        'Retries exhausted, request sent to the DLQ',
      );
    } catch (publishError) {
      this.logger.error(
        { err: publishError, source: requestId },
        'Error publishing the event to the DLQ',
      );
    }
  }
}
