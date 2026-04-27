'use strict';

module.exports = {
  rules: {
    'no-unscoped-prisma': require('./no-unscoped-prisma'),
    'no-bare-trpc-procedure': require('./no-bare-trpc-procedure'),
    'no-direct-audit-write': require('./no-direct-audit-write'),
  },
};
