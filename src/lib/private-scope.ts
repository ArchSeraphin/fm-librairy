declare const __privateScopeBrand: unique symbol;

/**
 * Type "Brand" non-construisible hors de `withCurrentUserScope`.
 * Toute query sur Annotation, Bookmark, ReadingProgress, ReadingSession
 * doit recevoir un PrivateScope, garantissant qu'on a explicitement
 * scope par userId.
 */
export type PrivateScope = {
  readonly userId: string;
  readonly [__privateScopeBrand]: true;
};

export function withCurrentUserScope(userId: string): PrivateScope {
  if (!userId || typeof userId !== 'string') {
    throw new Error('PrivateScope: userId requis et non vide');
  }
  return { userId, [__privateScopeBrand]: true } as PrivateScope;
}
