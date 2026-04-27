'use strict';

/**
 * Interdit `t.procedure.query/.mutation` direct — force le passage par
 * un wrapper d'auth (publicProcedure, authedProcedure, pendingProcedure,
 * globalAdminProcedure).
 *
 * publicProcedure est explicitement allowlisté pour les rares cas légitimes.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: "Force l'utilisation de procedures wrappers (anti-IDOR)" },
    schema: [],
    messages: {
      bareT:
        '`t.procedure.{{method}}` direct interdit. Utilisez publicProcedure (avec justification), authedProcedure, pendingProcedure ou globalAdminProcedure.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 't' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'procedure' &&
          node.property.type === 'Identifier' &&
          (node.property.name === 'query' || node.property.name === 'mutation')
        ) {
          context.report({ node, messageId: 'bareT', data: { method: node.property.name } });
        }
      },
    };
  },
};
