import { PrismaClient } from '@prisma/client';

let _client: PrismaClient | undefined;

// Reinitialise the singleton after DATABASE_URL has been set by containers.ts beforeAll.
// Because tests call `const prisma = getTestPrisma()` at module top level (before beforeAll),
// getTestPrisma() returns a Proxy so the variable always delegates to the current _client.
export function resetTestPrisma(): void {
  _client = new PrismaClient();
}

export function getTestPrisma(): PrismaClient {
  // Return a Proxy so that references captured before beforeAll still work after resetTestPrisma().
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (!_client) _client = new PrismaClient();
      const val = (_client as unknown as Record<string | symbol, unknown>)[prop];
      return typeof val === 'function' ? val.bind(_client) : val;
    },
  });
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
