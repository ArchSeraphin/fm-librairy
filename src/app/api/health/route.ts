import { NextResponse } from 'next/server';
import net from 'node:net';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { meili } from '@/lib/meili';
import { logger } from '@/lib/logger';
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
    const pong = await redis.ping();
    return { name: 'redis', ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'redis', ok: false, error: (err as Error).message };
  }
}

async function checkMeili(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const h = await meili.health();
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

export async function GET() {
  const checks = await Promise.all([checkDb(), checkRedis(), checkMeili(), checkClamav()]);
  const allOk = checks.every((c) => c.ok);
  const status = allOk ? 200 : 503;
  if (!allOk) {
    logger.warn({ checks }, 'health degraded');
  }
  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      checks,
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
