import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';

export interface TestKafkaBroker {
  container: StartedKafkaContainer;
  bootstrapServers: string;
  stop(): Promise<void>;
}

const KAFKA_IMAGE = 'confluentinc/cp-kafka:7.6.0';

const KAFKA_PLAINTEXT_PORT = 9093;

export async function startTestKafkaBroker(): Promise<TestKafkaBroker> {
  const container = await new KafkaContainer(KAFKA_IMAGE)
    .withKraft()
    .withEnvironment({ KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false' })
    .start();

  const bootstrapServers = `${container.getHost()}:${container.getMappedPort(KAFKA_PLAINTEXT_PORT)}`;

  return {
    container,
    bootstrapServers,
    stop: async () => {
      await container.stop();
    },
  };
}
