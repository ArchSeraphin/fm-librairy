import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { TrpcContext } from './context';

export const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
