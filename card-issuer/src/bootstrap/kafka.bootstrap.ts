import { Kafka, logLevel } from 'kafkajs';
import envs from '../config/environment-vars';
import { ReturnType, TBootstrap } from './bootstrap.type';

export interface KafkaBootstrapOverrides {
  brokers?: string[];
  clientId?: string;
}

export class KafkaBootstrap implements TBootstrap {
  private static kafka: Kafka;
  private static healthCheckKafka: Kafka | undefined;
  private static brokers: string[];
  private static clientId: string;

  initialize(overrides?: KafkaBootstrapOverrides): ReturnType {
    return new Promise((resolve, reject) => {
      try {
        const brokers = overrides?.brokers ?? [envs.kafkaBroker];
        const clientId = overrides?.clientId ?? envs.kafkaClientId;

        KafkaBootstrap.brokers = brokers;
        KafkaBootstrap.clientId = clientId;
        KafkaBootstrap.kafka = new Kafka({
          clientId,
          brokers,
          logLevel: logLevel.NOTHING,
        });
        resolve(true);
      } catch (error) {
        reject(error);
      }
    });
  }

  static getInstanceKafka(): Kafka {
    return KafkaBootstrap.kafka;
  }

  /**
   * Cliente Kafka liviano para el chequeo ACTIVO de conectividad
   * de `GET /health`
   */
  static getHealthCheckKafka(): Kafka {
    if (!KafkaBootstrap.healthCheckKafka) {
      KafkaBootstrap.healthCheckKafka = new Kafka({
        clientId: `${KafkaBootstrap.clientId}-health-check`,
        brokers: KafkaBootstrap.brokers,
        logLevel: logLevel.NOTHING,
        connectionTimeout: 2000,
        retry: { retries: 0 },
      });
    }
    return KafkaBootstrap.healthCheckKafka;
  }
}
