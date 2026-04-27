'use strict';

/**
 * Interdit `db.auditLog.create` ou `prisma.auditLog.create` direct.
 * Force le passage par `recordAudit` de `src/lib/audit-log.ts`.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Force le passage par recordAudit (typage + redact + hash IP)' },
    schema: [],
    messages: {
      direct: 'Écriture directe sur auditLog interdite. Utilisez `recordAudit` de @/lib/audit-log.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (filename.includes('lib/audit-log')) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'MemberExpression' &&
          callee.object.property.type === 'Identifier' &&
          callee.object.property.name === 'auditLog' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'create'
        ) {
          context.report({ node, messageId: 'direct' });
        }
      },
    };
  },
};
