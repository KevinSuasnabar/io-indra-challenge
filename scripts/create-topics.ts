import { Kafka, logLevel } from 'kafkajs';

const BROKER = process.env.KAFKA_BROKER ?? 'localhost:9092';
const TOPICS = ['io.card.requested.v1', 'io.cards.issued.v1', 'io.card.requested.v1.dlq'] as const;

async function main(): Promise<void> {
  const kafka = new Kafka({
    clientId: 'create-topics-script',
    brokers: [BROKER],
    logLevel: logLevel.NOTHING,
  });
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    const topicsToCreate = TOPICS.filter((t) => !existing.includes(t));
    if (topicsToCreate.length === 0) {
      console.log('All topics already exist.');
      return;
    }
    await admin.createTopics({
      waitForLeaders: true,
      topics: topicsToCreate.map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
    });
    console.log(`Topics created: ${topicsToCreate.join(', ')}`);
  } finally {
    await admin.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
