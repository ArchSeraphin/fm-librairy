import { t } from '../trpc';
import { authRouter } from './auth';
import { invitationRouter } from './invitation';

export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
});

export type AppRouter = typeof appRouter;
