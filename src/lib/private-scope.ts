// Symbole runtime privé au module — non exporté, donc impossible à
// référencer depuis l'extérieur. Combiné avec le type `unique symbol`
// déduit par TS, cela rend le brand non-construisible littéralement
// hors de `withCurrentUserScope`.
const privateScopeBrand: unique symbol = Symbol('privateScopeBrand');
type PrivateScopeBrand = typeof privateScopeBrand;

/**
 * Type "Brand" non-construisible hors de `withCurrentUserScope`.
 * Toute query sur Annotation, Bookmark, ReadingProgress, ReadingSession
 * doit recevoir un PrivateScope, garantissant qu'on a explicitement
 * scope par userId.
 */
export type PrivateScope = {
  readonly userId: string;
  readonly [privateScopeBrand]: true;
};

export type { PrivateScopeBrand };

export function withCurrentUserScope(userId: string): PrivateScope {
  if (!userId || typeof userId !== 'string') {
    throw new Error('PrivateScope: userId requis et non vide');
  }
  return { userId, [privateScopeBrand]: true };
}
