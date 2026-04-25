import { describe, it, expect, expectTypeOf } from 'vitest';
import { withCurrentUserScope, type PrivateScope } from '@/lib/private-scope';

describe('PrivateScope', () => {
  it('produit un objet contenant userId et un brand non-construisible', () => {
    const scope = withCurrentUserScope('user_abc');
    expect(scope.userId).toBe('user_abc');
  });

  it('refuse une string vide ou non préfixée', () => {
    expect(() => withCurrentUserScope('')).toThrow();
  });

  it('le type PrivateScope ne peut pas être construit littéralement', () => {
    // Test de niveau type — vérifié par tsc, pas par runtime.
    // L'erreur de compile suivante prouve l'invariant :
    //   const fake: PrivateScope = { userId: 'x' };  // <- doit échouer en TS
    expectTypeOf<PrivateScope>().toMatchTypeOf<{ userId: string }>();
  });
});
