'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { TRPCError } from '@trpc/server';
import { signIn } from '@/server/auth';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const SignupSchema = z.object({
  rawToken: z.string().min(20).max(100),
  displayName: z.string().min(1).max(80),
  password: z.string().min(12).max(200),
  confirmPassword: z.string().min(12).max(200),
  email: z.string().email(),
});

export type SignupState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function submitSignup(_prev: SignupState, fd: FormData): Promise<SignupState> {
  const parsed = SignupSchema.safeParse({
    rawToken: fd.get('rawToken')?.toString() ?? '',
    displayName: fd.get('displayName')?.toString() ?? '',
    password: fd.get('password')?.toString() ?? '',
    confirmPassword: fd.get('confirmPassword')?.toString() ?? '',
    email: fd.get('email')?.toString() ?? '',
  });
  if (!parsed.success) return { status: 'error', message: 'Champs invalides.' };
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { status: 'error', message: 'Les mots de passe ne correspondent pas.' };
  }
  const ctx = await createContext({ headers: await headers() });
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.invitation.consumeSignup({
      rawToken: parsed.data.rawToken,
      displayName: parsed.data.displayName,
      password: parsed.data.password,
    });
  } catch {
    return { status: 'error', message: 'Lien invalide ou expiré.' };
  }
  await signIn('credentials', {
    email: parsed.data.email,
    password: parsed.data.password,
    redirect: false,
  });
  redirect('/');
}

export type JoinState = { status: 'idle' } | { status: 'error'; message: string };

export async function submitJoin(rawToken: string): Promise<JoinState> {
  const ctx = await createContext({ headers: await headers() });
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.invitation.consumeJoin({ rawToken });
  } catch (err) {
    if (err instanceof TRPCError && err.message === 'EMAIL_MISMATCH') {
      return { status: 'error', message: 'Cette invitation ne vous est pas adressée.' };
    }
    return { status: 'error', message: 'Lien invalide ou expiré.' };
  }
  redirect('/');
}
