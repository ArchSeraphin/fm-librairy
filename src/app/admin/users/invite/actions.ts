'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const InputSchema = z.object({
  email: z.string().email().max(254),
  libraryId: z.string().cuid().optional(),
  proposedRole: z.enum(['MEMBER', 'LIBRARY_ADMIN']).optional(),
});

export type InviteState =
  | { status: 'idle' }
  | { status: 'success'; email: string }
  | { status: 'error'; code: 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'VALIDATION' | 'UNKNOWN' };

export async function submitInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = InputSchema.safeParse({
    email: formData.get('email')?.toString() ?? '',
    libraryId: (formData.get('libraryId')?.toString() || undefined) as string | undefined,
    proposedRole: (formData.get('proposedRole')?.toString() || undefined) as
      | 'MEMBER'
      | 'LIBRARY_ADMIN'
      | undefined,
  });
  if (!parsed.success) return { status: 'error', code: 'VALIDATION' };

  const ctx = await createContext({ headers: await headers() });
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.invitation.create(parsed.data);
    revalidatePath('/admin');
    return { status: 'success', email: parsed.data.email };
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === 'FORBIDDEN') return { status: 'error', code: 'FORBIDDEN' };
      if (err.code === 'TOO_MANY_REQUESTS') return { status: 'error', code: 'TOO_MANY_REQUESTS' };
    }
    return { status: 'error', code: 'UNKNOWN' };
  }
}
