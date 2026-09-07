import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  KAFKA_BROKER: z.string().min(1, 'KAFKA_BROKER is required (e.g. localhost:9092)'),
  KAFKA_CLIENT_ID: z.string().min(1).default('card-processor'),
  KAFKA_CONSUMER_GROUP_ID: z.string().min(1).default('card-processor-group'),
  SQLITE_DB_PATH: z.string().min(1).default('./data/card-processor.sqlite'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type EnvironmentVars = z.infer<typeof envSchema>;

export interface ReturnEnvironmentVars {
  nodeEnv: EnvironmentVars['NODE_ENV'];
  port: number;
  kafkaBroker: string;
  kafkaClientId: string;
  kafkaConsumerGroupId: string;
  sqliteDbPath: string;
  logLevel: EnvironmentVars['LOG_LEVEL'];
}

function loadEnvironmentVars(): ReturnEnvironmentVars {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Config validation error: ${result.error.message}`);
  }

  const value = result.data;
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    kafkaBroker: value.KAFKA_BROKER,
    kafkaClientId: value.KAFKA_CLIENT_ID,
    kafkaConsumerGroupId: value.KAFKA_CONSUMER_GROUP_ID,
    sqliteDbPath: value.SQLITE_DB_PATH,
    logLevel: value.LOG_LEVEL,
  };
}

const envs = loadEnvironmentVars();

export default envs;
