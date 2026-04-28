import { t } from '../trpc';
import { authRouter } from './auth';
import { invitationRouter } from './invitation';
import { passwordRouter } from './password';
import { adminUsersRouter } from './admin/users';

export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
  password: passwordRouter,
  admin: t.router({
    users: adminUsersRouter,
  }),
});

export type AppRouter = typeof appRouter;
