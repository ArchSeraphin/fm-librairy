/**
 * Interdit db.<model>.findMany() / findFirst() / findFirstOrThrow()
 * sans clause `where`. Évite les fuites de données cross-scope.
 *
 * Couche 2 : pour les modèles à scope library ou user, vérifie que la
 * clause `where` contient bien `libraryId` ou `userId` selon le modèle.
 *
 * Faux positifs acceptables : on peut désactiver localement avec
 * // eslint-disable-next-line local/no-unscoped-prisma -- raison: ...
 */
'use strict';

const FORBIDDEN_METHODS = new Set(['findMany', 'findFirst', 'findFirstOrThrow']);

const SCOPED_METHODS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'updateMany',
  'deleteMany',
]);

const LIBRARY_SCOPED_MODELS = new Set(['book', 'bookFile', 'physicalCopy']);
const USER_SCOPED_MODELS = new Set(['annotation', 'bookmark', 'readingProgress', 'readingSession']);

/**
 * Returns the scope-key requirement for a db.<model>.<method> call, or null
 * if no scope check applies.
 * @param {string} model
 * @returns {{ key: string, messageId: string } | null}
 */
function getScopeRequirement(model) {
  if (LIBRARY_SCOPED_MODELS.has(model)) {
    return { key: 'libraryId', messageId: 'missingLibraryScope' };
  }
  if (USER_SCOPED_MODELS.has(model)) {
    return { key: 'userId', messageId: 'missingUserScope' };
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Interdit findMany/findFirst Prisma sans clause where (anti-IDOR)',
    },
    schema: [],
    messages: {
      missingWhere:
        'Prisma `{{method}}` sans `where` interdit (risque de fuite cross-scope). Ajoutez `where` ou désactivez localement avec un commentaire justifié.',
      missingLibraryScope:
        '`db.{{model}}` : la clause `where` doit contenir `libraryId` pour scoper la requête à la librairie courante (anti-IDOR).',
      missingUserScope:
        "`db.{{model}}` : la clause `where` doit contenir `userId` pour scoper la requête à l'utilisateur courant (anti-IDOR).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier') return;

        const method = callee.property.name;

        // ── Couche 1 : tout appel findMany/findFirst/findFirstOrThrow sans where ──
        if (FORBIDDEN_METHODS.has(method)) {
          const arg = node.arguments[0];
          // Pas d'argument du tout
          if (!arg) {
            context.report({
              node,
              messageId: 'missingWhere',
              data: { method },
            });
            // Fall through to layer 2 check below
          } else if (arg.type === 'ObjectExpression') {
            // Argument est un objet littéral : vérifier qu'il a une clé `where`
            const hasWhere = arg.properties.some(
              (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where',
            );
            if (!hasWhere) {
              context.report({
                node,
                messageId: 'missingWhere',
                data: { method },
              });
            }
          }
          // Autres formes (Identifier, ConditionalExpression, ...) : acceptées faute de vérification statique fiable.
          // Note : un ObjectExpression contenant uniquement des SpreadElement (ex. `findMany({ ...opts })`) reste flagged
          // — c'est volontaire pour anti-IDOR. Désactiver localement avec un commentaire justifié si nécessaire.
        }

        // ── Couche 2 : db.<model>.<method> — vérification du scope-key ──
        if (!SCOPED_METHODS.has(method)) return;

        // Le receiver doit être db.<model> (MemberExpression dont l'objet est Identifier "db")
        const receiver = callee.object;
        if (receiver.type !== 'MemberExpression') return;
        if (receiver.object.type !== 'Identifier') return;
        if (receiver.object.name !== 'db') return;
        if (receiver.property.type !== 'Identifier') return;

        const model = receiver.property.name;
        const scopeReq = getScopeRequirement(model);
        if (!scopeReq) return;

        // Check that the first argument is an ObjectExpression with a `where`
        // property that is itself an ObjectExpression containing the scope key.
        const arg = node.arguments[0];
        if (!arg) {
          // No argument at all — also report missingLibraryScope/missingUserScope
          context.report({
            node,
            messageId: scopeReq.messageId,
            data: { model },
          });
          return;
        }
        if (arg.type !== 'ObjectExpression') {
          // Can't statically verify — accept
          return;
        }

        const whereProp = arg.properties.find(
          (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where',
        );

        if (!whereProp) {
          // where is missing entirely — also report scope key missing
          context.report({
            node,
            messageId: scopeReq.messageId,
            data: { model },
          });
          return;
        }

        // where exists; check that its value ObjectExpression contains the scope key
        const whereValue = whereProp.value;
        if (whereValue.type !== 'ObjectExpression') {
          // Dynamic where object — can't verify statically; accept
          return;
        }

        const hasScopeKey = whereValue.properties.some(
          (p) =>
            p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === scopeReq.key,
        );

        if (!hasScopeKey) {
          context.report({
            node,
            messageId: scopeReq.messageId,
            data: { model },
          });
        }
      },
    };
  },
};
