import { PrismaClient } from '@prisma/client';
import { config } from './env';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      config.server.env === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (config.server.env !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<boolean> {
  try {
    await prisma.$connect();
    console.log('✅ [Database] PostgreSQL connected via Prisma Client.');
    return true;
  } catch (error) {
    console.warn('⚠️  [Database] PostgreSQL connection deferred (database service offline or starting up).');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
