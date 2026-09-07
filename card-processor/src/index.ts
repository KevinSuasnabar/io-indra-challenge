import envs from './config/environment-vars';
import { createLogger } from './logger';
import { createApp } from './app';
import { ReturnType } from './bootstrap/bootstrap.type';
import { DatabaseBootstrap } from './bootstrap/database.bootstrap';
import { KafkaBootstrap } from './bootstrap/kafka.bootstrap';
import { ServerBootstrap } from './bootstrap/server.bootstrap';
import { ProducerService } from './core/services/producer.service';
import { ConsumerService } from './core/services/consumer.service';
import { CardIssuanceRepositoryInfrastructure } from './modules/infraestructure/persistance/card-issuance.repository.infraestructure';
import { ProcessCardIssuanceApplication } from './modules/application/card-issuance.application';

const logger = createLogger(envs.logLevel);
const databaseBootstrap = new DatabaseBootstrap();
const kafkaBootstrap = new KafkaBootstrap();

(async () => {
  try {
    await kafkaBootstrap.initialize();

    const databaseInitPromise = databaseBootstrap.initialize();
    const repository = new CardIssuanceRepositoryInfrastructure(DatabaseBootstrap.dataSource);
    const producerService = new ProducerService(logger);
    const application = new ProcessCardIssuanceApplication(repository, producerService, logger);
    const consumerService = new ConsumerService(
      application,
      producerService,
      logger,
      envs.kafkaConsumerGroupId,
    );

    const app = createApp({
      eventPublisher: producerService,
      consumer: consumerService,
      logger,
    });
    const serverBootstrap = new ServerBootstrap(app, logger);

    const instances: ReturnType[] = [serverBootstrap.initialize(), databaseInitPromise];
    await Promise.all(instances);
    logger.info('Connected to the database');

    await producerService.connect();
    logger.info('Connected to the Kafka producer');

    await consumerService.connect();
    logger.info('Connected to the card-processor consumer');

    let shuttingDown = false;

    const shutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info(`Signal ${signal} received, starting graceful shutdown`);

      void serverBootstrap
        .close()
        .then(() => consumerService.disconnect())
        .then(() => producerService.disconnect())
        .then(() => {
          databaseBootstrap.close();
          logger.info('Graceful shutdown complete (consumer, producer and DB closed)');
          process.exit(0);
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Error during shutdown');
          process.exit(1);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Fatal error starting card-processor:', error);
    databaseBootstrap.close();
    process.exit(1);
  }
})();
