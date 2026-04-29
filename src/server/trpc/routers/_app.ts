import { t } from '../trpc';
import { authRouter } from './auth';
import { invitationRouter } from './invitation';
import { passwordRouter } from './password';
import { adminUsersRouter } from './admin/users';
import { adminLibrariesRouter } from './admin/libraries';
import { accountProfileRouter } from './account/profile';

export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
  password: passwordRouter,
  admin: t.router({
    users: adminUsersRouter,
    libraries: adminLibrariesRouter,
  }),
  account: t.router({
    profile: accountProfileRouter,
  }),
});

export type AppRouter = typeof appRouter;
