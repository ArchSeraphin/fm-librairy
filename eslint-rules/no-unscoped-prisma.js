/**
 * Interdit db.<model>.findMany() / findFirst() / findFirstOrThrow()
 * sans clause `where`. Évite les fuites de données cross-scope.
 *
 * Faux positifs acceptables : on peut désactiver localement avec
 * // eslint-disable-next-line no-unscoped-prisma -- raison: ...
 */
'use strict';

const FORBIDDEN_METHODS = new Set(['findMany', 'findFirst', 'findFirstOrThrow']);

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
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier') return;
        if (!FORBIDDEN_METHODS.has(callee.property.name)) return;

        const arg = node.arguments[0];
        // Pas d'argument du tout
        if (!arg) {
          context.report({
            node,
            messageId: 'missingWhere',
            data: { method: callee.property.name },
          });
          return;
        }
        // Argument est un objet littéral : vérifier qu'il a une clé `where`
        if (arg.type === 'ObjectExpression') {
          const hasWhere = arg.properties.some(
            (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where',
          );
          if (!hasWhere) {
            context.report({
              node,
              messageId: 'missingWhere',
              data: { method: callee.property.name },
            });
          }
        }
        // Argument est dynamique (Identifier, etc.) : on accepte (ne peut pas vérifier statiquement)
      },
    };
  },
};
