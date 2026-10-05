import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.string().default('4000').transform(val => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PREFIX: z.string().default('/api/v1'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:5000,http://127.0.0.1:3000,http://127.0.0.1:5000'),

  DATABASE_URL: z.string().default('postgresql://nummf_user:nummf_pass@localhost:5432/nummf_db'),
  DB_POOL_MIN: z.string().default('2').transform(val => parseInt(val, 10)),
  DB_POOL_MAX: z.string().default('10').transform(val => parseInt(val, 10)),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long').default('nummf_dev_secret_key_at_least_16_chars_long'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  REFRESH_TOKEN_SECRET: z.string().min(16, 'REFRESH_TOKEN_SECRET must be at least 16 characters long').default('nummf_dev_refresh_secret_key_at_least_16_chars'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),

  ENABLE_TENANT_ISOLATION: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  ENABLE_AUTO_MATCHING: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  MAX_FILE_UPLOAD_MB: z.string().default('25').transform(val => parseInt(val, 10)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ [Config Error] Invalid environment variables:\n', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production') {
  if (parsed.data.REFRESH_TOKEN_SECRET.includes('dev_refresh')) {
    parsed.data.REFRESH_TOKEN_SECRET = `${parsed.data.JWT_SECRET}_refresh_key_2026`;
  }
  if (parsed.data.JWT_SECRET.includes('dev_secret')) {
    console.error('\n❌ [Security Error] Default development JWT secrets cannot be used in production environment!\n');
    process.exit(1);
  }
}

export const env = parsed.data;

export const config = {
  server: {
    port: env.PORT,
    env: env.NODE_ENV,
    apiPrefix: env.API_PREFIX,
    clientUrl: env.CLIENT_URL,
    allowedOrigins: env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean),
    logLevel: env.LOG_LEVEL,
  },
  database: {
    url: env.DATABASE_URL,
    poolMin: env.DB_POOL_MIN,
    poolMax: env.DB_POOL_MAX,
  },
  redis: {
    url: env.REDIS_URL,
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    refreshTokenSecret: env.REFRESH_TOKEN_SECRET,
    refreshTokenExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    embeddingModel: env.GEMINI_EMBEDDING_MODEL,
    isConfigured: env.GEMINI_API_KEY.length > 0,
  },
  features: {
    tenantIsolation: env.ENABLE_TENANT_ISOLATION,
    autoMatching: env.ENABLE_AUTO_MATCHING,
    maxFileUploadMb: env.MAX_FILE_UPLOAD_MB,
  },
} as const;

export type AppConfig = typeof config;
