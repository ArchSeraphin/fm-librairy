import { PrismaClient } from '@prisma/client';

let _client: PrismaClient | undefined;

export function getTestPrisma(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

export async function truncateAll(): Promise<void> {
  const prisma = getTestPrisma();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const names = tables.map((t: { tablename: string }) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

export async function teardownTestPrisma(): Promise<void> {
  await _client?.$disconnect();
  _client = undefined;
}
