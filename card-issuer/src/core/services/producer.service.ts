import { Producer } from 'kafkajs';
import { Logger } from '../../logger';
import { CardRequestEventPublisher } from '../../modules/domain/ports/card-request-event-publisher.port';
import { KafkaService } from './kafka.service';

export class ProducerService implements CardRequestEventPublisher {
  private producer: Producer | undefined;
  private connected = false;

  constructor(private readonly logger: Logger) {}

  async connect(): Promise<void> {
    this.producer = await KafkaService.connectProducer();
    this.connected = true;
    this.logger.info('Kafka producer connected');

    this.producer.on(this.producer.events.DISCONNECT, () => {
      this.connected = false;
      this.logger.warn('Kafka producer disconnected');
    });
  }

  async disconnect(): Promise<void> {
    await KafkaService.disconnectProducer();
    this.connected = false;
  }

  async isConnected(): Promise<boolean> {
    if (!this.connected) {
      return false;
    }
    return KafkaService.isBrokerReachable();
  }

  async publish(message: object, key: string, topic: string): Promise<void> {
    if (!this.producer) {
      throw new Error('ProducerService is not connected: call connect() before publish()');
    }

    await this.producer.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify(message),
        },
      ],
    });
    this.logger.info({ key }, `Event published to ${topic}`);
  }
}
