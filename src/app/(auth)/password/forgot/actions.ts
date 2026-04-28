'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const Schema = z.object({ email: z.string().email().max(254) });

export type ForgotState =
  | { status: 'idle' }
  | { status: 'submitted' }
  | { status: 'error'; message: string };

export async function submitForgot(_p: ForgotState, fd: FormData): Promise<ForgotState> {
  const parsed = Schema.safeParse({ email: fd.get('email')?.toString() ?? '' });
  if (!parsed.success) return { status: 'error', message: 'Email invalide.' };
  const ctx = await createContext({ headers: await headers() });
  const caller = appRouter.createCaller(ctx);
  await caller.password.requestReset({ email: parsed.data.email });
  return { status: 'submitted' };
}
