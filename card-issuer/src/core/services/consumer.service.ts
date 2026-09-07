import { CardRequestStatusEnum } from '../../constants/card-request-status.enum';
import { CARDS_ISSUED_TOPIC, CARD_REQUESTED_DLQ_TOPIC } from '../../constants/kafka-topics';
import { Logger } from '../../logger';
import { CardRequestRepository } from '../../modules/domain/ports/card-request-repository.port';
import { KafkaService } from './kafka.service';

const STATUS_BY_EVENT_TYPE: Record<string, CardRequestStatusEnum> = {
  [CARDS_ISSUED_TOPIC]: CardRequestStatusEnum.ISSUED,
  [CARD_REQUESTED_DLQ_TOPIC]: CardRequestStatusEnum.FAILED,
};

interface SyncEvent {
  source: string;
  type: string;
  data?: {
    error?: {
      reason?: unknown;
      attempts?: unknown;
    };
  };
}

function parseSyncEvent(rawValue: Buffer | string | null | undefined): SyncEvent | undefined {
  if (!rawValue) {
    return undefined;
  }
  let event: unknown;
  try {
    event = JSON.parse(rawValue.toString());
  } catch {
    return undefined;
  }
  if (
    typeof event !== 'object' ||
    event === null ||
    typeof (event as Record<string, unknown>).source !== 'string' ||
    typeof (event as Record<string, unknown>).type !== 'string'
  ) {
    return undefined;
  }
  return event as SyncEvent;
}

export class ConsumerService {
  private connected = false;

  constructor(
    private readonly repository: CardRequestRepository,
    private readonly logger: Logger,
    private readonly groupId: string,
  ) {}

  async connect(): Promise<void> {
    const consumer = await KafkaService.connectConsumer(this.groupId);
    await consumer.subscribe({ topic: CARDS_ISSUED_TOPIC, fromBeginning: false });
    await consumer.subscribe({ topic: CARD_REQUESTED_DLQ_TOPIC, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => this.handleMessage(message.value),
    });
    this.connected = true;
    this.logger.info('Consumer de sincronización de estado conectado');
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
    const event = parseSyncEvent(rawValue);

    if (!event) {
      this.logger.error(
        { rawValue: rawValue?.toString() },
        'Evento recibido con forma inesperada, no se pudo sincronizar el estado de la solicitud',
      );
      return;
    }

    const status = STATUS_BY_EVENT_TYPE[event.type];
    if (!status) {
      this.logger.error(
        { source: event.source, type: event.type },
        'Tipo de evento no reconocido por el consumer de sincronización',
      );
      return;
    }

    const now = new Date().toISOString();

    try {
      if (status === CardRequestStatusEnum.FAILED) {
        const reason = event.data?.error?.reason;
        const attempts = event.data?.error?.attempts;

        if (typeof reason !== 'string' || typeof attempts !== 'number') {
          this.logger.error(
            { source: event.source, reason, attempts },
            'DLQ event without valid data.error.reason/data.error.attempts, could not sync the request status',
          );
          return;
        }

        await this.repository.markAsFailed(event.source, reason, attempts, now);
      } else {
        await this.repository.updateStatusByRequestId(event.source, status, now);
      }

      this.logger.info({ source: event.source, status }, 'Estado de la solicitud sincronizado');
    } catch (error) {
      this.logger.error(
        { err: error, source: event.source },
        'Error sincronizando el estado de la solicitud',
      );
    }
  }
}