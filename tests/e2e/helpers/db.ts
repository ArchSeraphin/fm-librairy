import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { hashEmail } from '../../../src/lib/crypto';

let prisma: PrismaClient | undefined;
let redis: Redis | undefined;

const TEST_EMAIL_SUFFIX = '@e2e.test';

export function getPrisma(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set — globalSetup did not load .env.local');
    redis = new Redis(url);
  }
  return redis;
}

// Targeted cleanup: only delete users whose email ends with @e2e.test, plus
// every record FK-bound to them (sessions, twoFactorSecrets, audit-as-actor).
// AuditLog rows that target EMAIL hashes (no FK) are scoped to the @e2e.test
// emails by computing their hashes — keeps dev audit history intact.
export async function cleanupTestData(): Promise<void> {
  const p = getPrisma();
  const testUsers = await p.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true, email: true },
  });
  const ids = testUsers.map((u) => u.id);
  const emailHashes = testUsers.map((u) => hashEmail(u.email));
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.twoFactorSecret.deleteMany({ where: { userId: { in: ids } } });
  await p.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: ids } },
        { AND: [{ targetType: 'EMAIL' }, { targetId: { in: emailHashes } }] },
      ],
    },
  });
  await p.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_SUFFIX } } });
}

// Targeted cleanup for E2E libraries scoped by slug. Order respects FKs:
// libraryMember → invitation → library.
export async function cleanupE2ELibrary(slug: string): Promise<void> {
  const p = getPrisma();
  await p.libraryMember.deleteMany({ where: { library: { slug } } });
  await p.invitation.deleteMany({ where: { library: { slug } } });
  await p.library.deleteMany({ where: { slug } });
}

// Hash a raw test email for audit-row lookups (e.g. Scenario 5).
export async function hashTestEmail(email: string): Promise<string> {
  return hashEmail(email);
}

// Flush rate-limit state so each scenario starts with a fresh budget.
// rate-limit.ts uses keyPrefix `rl:login`, `rl:login_ip`, `rl:2fa`, `rl:reset`, `rl:reset_ip`,
// `rl:invite`, plus Phase 1C limiters `rl:pwd_change`, `rl:2fa_reenroll`, `rl:backup_regen`,
// `rl:profile_update`. Scoped to those prefixes — no impact on the rest of Redis.
export async function flushRateLimit(): Promise<void> {
  const r = getRedis();
  for (const prefix of [
    'rl:login:*',
    'rl:login_ip:*',
    'rl:2fa:*',
    'rl:reset:*',
    'rl:reset_ip:*',
    'rl:invite:*',
    'rl:pwd_change:*',
    'rl:2fa_reenroll:*',
    'rl:backup_regen:*',
    'rl:profile_update:*',
  ]) {
    const keys = await r.keys(prefix);
    if (keys.length) await r.del(...keys);
  }
  // TOTP replay nonces (Task 13 fix HIGH+MED) live under `2fa-replay:*` ;
  // wiping them lets the same TOTP code be reused across test runs.
  const replayKeys = await r.keys('2fa-replay:*');
  if (replayKeys.length) await r.del(...replayKeys);
}

// Disconnect Prisma + Redis at the end of each spec file's afterAll. We also
// reset the module-level singletons so the NEXT spec file in the same Playwright
// worker process gets a fresh connection — previously the second file would
// try to use the already-quit Redis client and crash with "Connection is closed".
export async function disconnect(): Promise<void> {
  try {
    await prisma?.$disconnect();
  } catch {
    /* ignore */
  }
  try {
    await redis?.quit();
  } catch {
    /* ignore */
  }
  prisma = undefined;
  redis = undefined;
}
