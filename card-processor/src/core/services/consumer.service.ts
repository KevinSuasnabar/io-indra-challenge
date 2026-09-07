import { randomUUID } from 'node:crypto';
import { CARD_REQUESTED_DLQ_TOPIC, CARD_REQUESTED_TOPIC } from '../../constants/kafka-topics';
import { cardProcessingDlqMessagesTotal, cardProcessingRequestsReceivedTotal } from '../../metrics';
import { buildCardRequestedDlqEvent } from '../../modules/domain/events';
import { CardIssuanceEventPublisher } from '../../modules/domain/ports/card-issuance-event-publisher.port';
import { cardRequestedEventSchema } from '../../modules/infraestructure/schemas/card-requested-event.schema';
import { ProcessCardIssuanceApplication } from '../../modules/application/card-issuance.application';
import { Logger } from '../../logger';
import { KafkaService } from './kafka.service';

function tryExtractSource(raw: unknown): string | undefined {
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as Record<string, unknown>).source === 'string'
  ) {
    return (raw as Record<string, unknown>).source as string;
  }
  return undefined;
}

export class ConsumerService {
  private connected = false;

  constructor(
    private readonly application: ProcessCardIssuanceApplication,
    private readonly publisher: CardIssuanceEventPublisher,
    private readonly logger: Logger,
    private readonly groupId: string,
  ) {}

  async connect(): Promise<void> {
    const consumer = await KafkaService.connectConsumer(this.groupId);

    await consumer.subscribe({ topic: CARD_REQUESTED_TOPIC, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => this.handleMessage(message.value),
    });

    this.connected = true;
    this.logger.info('card-processor consumer connected and subscribed to io.card.requested.v1');
  }

  async disconnect(): Promise<void> {
    await KafkaService.disconnectConsumer();
    this.connected = false;
  }

  async isConnected(): Promise<boolean> {
    if (!this.connected) {
      return false;
    }
    return KafkaService.isBrokerReachable();
  }

  async handleMessage(rawValue: Buffer | string | null | undefined): Promise<void> {
    cardProcessingRequestsReceivedTotal.inc();

    let parsedJson: unknown;
    try {
      parsedJson = rawValue ? JSON.parse(rawValue.toString()) : undefined;
    } catch {
      await this.publishSchemaErrorToDlq(
        undefined,
        rawValue?.toString(),
        'The received message is not valid JSON',
      );
      return;
    }

    const result = cardRequestedEventSchema.safeParse(parsedJson);
    if (!result.success) {
      const source = tryExtractSource(parsedJson);
      await this.publishSchemaErrorToDlq(
        source,
        parsedJson,
        `The event does not match the expected io.card.requested.v1 schema: ${result.error.message}`,
      );
      return;
    }

    await this.application.execute(result.data);
  }

  private async publishSchemaErrorToDlq(
    source: string | undefined,
    originalPayload: unknown,
    reason: string,
  ): Promise<void> {
    const requestId = source ?? randomUUID();
    this.logger.error(
      { source: requestId, reason },
      'Request event with invalid schema (permanent error), publishing straight to the DLQ',
    );

    const dlqEvent = buildCardRequestedDlqEvent({
      requestId,
      originalPayload,
      reason,
      attempts: 0,
    });

    try {
      await this.publisher.publish(dlqEvent, requestId, CARD_REQUESTED_DLQ_TOPIC);
      cardProcessingDlqMessagesTotal.inc({ reason: 'invalid_schema' });
    } catch (publishError) {
      this.logger.error(
        { err: publishError, source: requestId },
        'Error publishing the event to the DLQ',
      );
    }
  }
}
