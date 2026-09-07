import envs from './config/environment-vars';
import { createLogger } from './logger';
import { createApp } from './app';
import { ReturnType } from './bootstrap/bootstrap.type';
import { DatabaseBootstrap } from './bootstrap/database.bootstrap';
import { KafkaBootstrap } from './bootstrap/kafka.bootstrap';
import { ServerBootstrap } from './bootstrap/server.bootstrap';
import { ProducerService } from './core/services/producer.service';
import { ConsumerService } from './core/services/consumer.service';
import { CardRequestApplication } from './modules/application/card-request.application';
import { CardRequestRepositoryInfrastructure } from './modules/infraestructure/persistence/card-request.repository.infraestructure';

const logger = createLogger(envs.logLevel);
const databaseBootstrap = new DatabaseBootstrap();
const kafkaBootstrap = new KafkaBootstrap();

(async () => {
  try {
    await kafkaBootstrap.initialize();

    const databaseInitPromise = databaseBootstrap.initialize();
    const repository = new CardRequestRepositoryInfrastructure(DatabaseBootstrap.dataSource);
    const producerService = new ProducerService(logger);
    const consumerService = new ConsumerService(repository, logger, envs.kafkaConsumerGroupId);
    const application = new CardRequestApplication(repository, producerService);

    const app = createApp({
      application,
      eventPublisher: producerService,
      statusSyncConsumer: consumerService,
      logger,
      rateLimitWindowMs: envs.rateLimitWindowMs,
      rateLimitMax: envs.rateLimitMax,
      corsAllowedOrigins: envs.corsAllowedOrigins,
    });
    const serverBootstrap = new ServerBootstrap(app, logger);

    const instances: ReturnType[] = [serverBootstrap.initialize(), databaseInitPromise];
    await Promise.all(instances);
    logger.info('Connected to the database');

    await producerService.connect();
    logger.info('Connected to the Kafka producer');

    await consumerService.connect();
    logger.info('Connected to the status-sync consumer');

    let shuttingDown = false;

    const shutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info(`Signal ${signal} received, starting graceful shutdown`);

      void serverBootstrap
        .close()
        .then(() => producerService.disconnect())
        .then(() => consumerService.disconnect())
        .then(() => {
          databaseBootstrap.close();
          logger.info('Graceful shutdown complete (producer, consumer and DB closed)');
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
    console.error('Fatal error starting card-issuer:', error);
    databaseBootstrap.close();
    process.exit(1);
  }
})();
