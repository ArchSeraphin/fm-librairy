import { vi } from 'vitest';
import { auth } from '@/server/auth';

/**
 * Scope a fake authenticated session for the duration of `fn`.
 *
 * Important: this helper assumes the caller has already mocked `@/server/auth`
 * via `vi.mock(...)` AT THE TOP OF THE TEST FILE. We cannot put `vi.mock` inside
 * this helper, because Vitest only hoists `vi.mock` calls to the top of the file
 * that contains them — placing it here would not intercept transitive imports of
 * `@/server/auth` triggered by the test's other imports.
 *
 * Token shape: the real `auth()` (NextAuth JWT strategy, see src/server/auth/config.ts
 * jwt callback) returns a JWT-like object with the user id at top-level `userId`.
 * We expose both `userId` and `user.id` so call-sites using either shape work.
 */
export async function withAuthedRequest<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  // The runtime `auth` is a vi.fn from the test-side vi.mock; cast through unknown
  // to bypass the NextAuth overload union which is not relevant in a mocked context.
  const mock = vi.mocked(auth as unknown as (...args: unknown[]) => Promise<unknown>);
  const previous = mock.getMockImplementation();
  mock.mockImplementation(
    async () =>
      ({
        userId,
        user: { id: userId },
        expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      }) as unknown,
  );
  try {
    return await fn();
  } finally {
    if (previous) mock.mockImplementation(previous);
    else mock.mockReset();
  }
}
