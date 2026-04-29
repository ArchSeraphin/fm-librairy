import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { extractIpFromHeaders } from '@/lib/request-meta';
import type { Session, User } from '@prisma/client';

export interface TrpcContext {
  session: Session | null;
  user: User | null;
  ip: string;
}

export async function createContext(opts?: { headers?: Headers }): Promise<TrpcContext> {
  const result = await getCurrentSessionAndUser();
  const ip = opts?.headers ? extractIpFromHeaders(opts.headers) : '0.0.0.0';
  return { session: result?.session ?? null, user: result?.user ?? null, ip };
}
