import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import type { Session, User } from '@prisma/client';

export interface TrpcContext {
  session: Session | null;
  user: User | null;
}

export async function createContext(): Promise<TrpcContext> {
  const result = await getCurrentSessionAndUser();
  return { session: result?.session ?? null, user: result?.user ?? null };
}
