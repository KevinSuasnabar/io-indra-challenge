import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  KAFKA_BROKER: z.string().min(1, 'KAFKA_BROKER is required (e.g. localhost:9092)'),
  KAFKA_CLIENT_ID: z.string().min(1).default('card-issuer'),
  KAFKA_CONSUMER_GROUP_ID: z.string().min(1).default('card-issuer-status-sync'),
  SQLITE_DB_PATH: z.string().min(1).default('./data/card-issuer.sqlite'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ALLOWED_ORIGINS: z.string().min(1).default('http://localhost:5173'),
});

export type EnvironmentVars = z.infer<typeof envSchema>;

export interface ReturnEnvironmentVars {
  nodeEnv: EnvironmentVars['NODE_ENV'];
  port: number;
  kafkaBroker: string;
  kafkaClientId: string;
  kafkaConsumerGroupId: string;
  sqliteDbPath: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  logLevel: EnvironmentVars['LOG_LEVEL'];
  corsAllowedOrigins: string[];
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
    rateLimitWindowMs: value.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: value.RATE_LIMIT_MAX,
    logLevel: value.LOG_LEVEL,
    corsAllowedOrigins: value.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
  };
}

const envs = loadEnvironmentVars();

export default envs;
