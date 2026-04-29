import { t } from '../trpc';
import { authRouter } from './auth';
import { invitationRouter } from './invitation';
import { passwordRouter } from './password';
import { adminUsersRouter } from './admin/users';
import { adminLibrariesRouter } from './admin/libraries';
import { accountProfileRouter } from './account/profile';
import { accountSecurityRouter } from './account/security';

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
    security: accountSecurityRouter,
  }),
});

export type AppRouter = typeof appRouter;
