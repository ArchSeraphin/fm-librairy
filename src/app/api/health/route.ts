import { NextResponse } from 'next/server';
import net from 'node:net';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { getMeili } from '@/lib/meili';
import { getLogger } from '@/lib/logger';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CheckResult = { name: string; ok: boolean; latencyMs?: number; error?: string };

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { name: 'postgres', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'postgres', ok: false, error: (err as Error).message };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const pong = await getRedis().ping();
    return { name: 'redis', ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'redis', ok: false, error: (err as Error).message };
  }
}

async function checkMeili(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const h = await getMeili().health();
    return { name: 'meilisearch', ok: h.status === 'available', latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'meilisearch', ok: false, error: (err as Error).message };
  }
}

async function checkClamav(): Promise<CheckResult> {
  const env = getEnv();
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const finalize = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve({ name: 'clamav', ok, latencyMs: Date.now() - start, error });
    };
    socket.setTimeout(2000);
    socket.on('error', (e) => finalize(false, e.message));
    socket.on('timeout', () => finalize(false, 'timeout'));
    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      socket.write('PING\n');
    });
    socket.on('data', (data) => finalize(data.toString().trim() === 'PONG'));
  });
}

function publicCheck(c: CheckResult, isProd: boolean): CheckResult {
  if (c.ok || !isProd) return c;
  return { ...c, error: 'check_failed' };
}

export async function GET() {
  const isProd = getEnv().NODE_ENV === 'production';
  const checks = await Promise.all([checkDb(), checkRedis(), checkMeili(), checkClamav()]);
  const allOk = checks.every((c) => c.ok);
  const status = allOk ? 200 : 503;
  if (!allOk) {
    getLogger().warn({ checks }, 'health degraded');
  }
  const publicChecks = checks.map((c) => publicCheck(c, isProd));
  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      checks: publicChecks,
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
