import { t } from '../trpc';
import { authRouter } from './auth';
import { invitationRouter } from './invitation';
import { passwordRouter } from './password';
import { adminUsersRouter } from './admin/users';
import { adminLibrariesRouter } from './admin/libraries';

export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
  password: passwordRouter,
  admin: t.router({
    users: adminUsersRouter,
    libraries: adminLibrariesRouter,
  }),
});

export type AppRouter = typeof appRouter;
