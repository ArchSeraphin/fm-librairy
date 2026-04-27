import type { PrismaClient, Session } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30j absolu
const INACTIVITY_TTL_MS = 7 * 24 * 3600 * 1000; // 7j inactif
const TOUCH_DEBOUNCE_MS = 60 * 1000; // 1 min

// Process-local debounce. Single-instance deploy (one VPS) — if we ever scale
// horizontally, move this to Redis or accept "best-effort debounce".
const lastTouchByToken = new Map<string, number>();

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateSessionInput {
  userId: string;
  ipHash: string;
  userAgentHash: string;
  pending2fa?: boolean;
}

export function createSessionAdapter(prisma: PrismaClient) {
  return {
    async createSession(input: CreateSessionInput): Promise<Session> {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { twoFactorEnabled: true },
      });
      const pending = input.pending2fa ?? !!user?.twoFactorEnabled;
      return prisma.session.create({
        data: {
          sessionToken: generateSessionToken(),
          userId: input.userId,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          pending2fa: pending,
        },
      });
    },

    async getSession(sessionToken: string): Promise<Session | null> {
      const s = await prisma.session.findUnique({ where: { sessionToken } });
      if (!s) return null;
      const now = Date.now();
      const isExpired = s.expiresAt.getTime() < now;
      const isInactive = now - s.lastActivityAt.getTime() > INACTIVITY_TTL_MS;
      if (isExpired || isInactive) {
        await prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
        lastTouchByToken.delete(sessionToken);
        return null;
      }
      const lastTouch = lastTouchByToken.get(sessionToken) ?? 0;
      if (now - lastTouch > TOUCH_DEBOUNCE_MS) {
        lastTouchByToken.set(sessionToken, now);
        await prisma.session
          .update({
            where: { id: s.id },
            data: { lastActivityAt: new Date(now) },
          })
          .catch(() => undefined);
      }
      return s;
    },

    async deleteSession(sessionToken: string): Promise<void> {
      await prisma.session.delete({ where: { sessionToken } }).catch(() => undefined);
      lastTouchByToken.delete(sessionToken);
    },

    async upgradePendingSession(input: {
      oldSessionId: string;
      ipHash: string;
      userAgentHash: string;
    }): Promise<Session> {
      const old = await prisma.session.findUnique({ where: { id: input.oldSessionId } });
      if (!old) throw new Error('Session pending introuvable');
      const [, fresh] = await prisma.$transaction([
        prisma.session.delete({ where: { id: old.id } }),
        prisma.session.create({
          data: {
            sessionToken: generateSessionToken(),
            userId: old.userId,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
            ipHash: input.ipHash,
            userAgentHash: input.userAgentHash,
            pending2fa: false,
          },
        }),
      ]);
      lastTouchByToken.delete(old.sessionToken);
      return fresh;
    },
  };
}

export type SessionAdapter = ReturnType<typeof createSessionAdapter>;
