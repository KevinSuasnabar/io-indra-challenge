import { Consumer, Partitioners, Producer } from 'kafkajs';
import { KafkaBootstrap } from '../../bootstrap/kafka.bootstrap';

let producer: Producer | undefined;
let consumer: Consumer | undefined;

async function connectProducer(): Promise<Producer> {
  if (producer) {
    return producer;
  }

  producer = KafkaBootstrap.getInstanceKafka().producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });

  await producer.connect();
  return producer;
}

async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = undefined;
  }
}

async function connectConsumer(groupId: string): Promise<Consumer> {
  if (consumer) {
    return consumer;
  }

  consumer = KafkaBootstrap.getInstanceKafka().consumer({ groupId });

  await consumer.connect();
  return consumer;
}

async function disconnectConsumer(): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = undefined;
  }
}

async function isBrokerReachable(): Promise<boolean> {
  const admin = KafkaBootstrap.getHealthCheckKafka().admin();
  try {
    await admin.connect();
    return true;
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export const KafkaService = {
  connectProducer,
  disconnectProducer,
  connectConsumer,
  disconnectConsumer,
  isBrokerReachable,
};
