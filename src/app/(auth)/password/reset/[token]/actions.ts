'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const Schema = z.object({
  rawToken: z.string().min(20).max(100),
  newPassword: z.string().min(12).max(200),
  confirmPassword: z.string().min(12).max(200),
});

export type ResetState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'error'; message: string };

export async function submitReset(_prev: ResetState, fd: FormData): Promise<ResetState> {
  const parsed = Schema.safeParse({
    rawToken: fd.get('rawToken')?.toString() ?? '',
    newPassword: fd.get('newPassword')?.toString() ?? '',
    confirmPassword: fd.get('confirmPassword')?.toString() ?? '',
  });
  if (!parsed.success) return { status: 'error', message: 'Champs invalides.' };
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { status: 'error', message: 'Les mots de passe ne correspondent pas.' };
  }
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.password.consumeReset({
      rawToken: parsed.data.rawToken,
      newPassword: parsed.data.newPassword,
    });
  } catch (err) {
    if (err instanceof TRPCError && err.message === 'INVALID_TOKEN') {
      return { status: 'error', message: 'Lien invalide ou expiré.' };
    }
    return { status: 'error', message: 'Une erreur est survenue. Réessayez plus tard.' };
  }
  redirect('/login?reset=1');
}
