import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-unscoped-prisma.js';
import bareTrpcRule from '../../eslint-rules/no-bare-trpc-procedure.js';
import directAuditRule from '../../eslint-rules/no-direct-audit-write.js';

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-unscoped-prisma', () => {
  it('passes valid and rejects invalid', () => {
    tester.run('no-unscoped-prisma', rule, {
      valid: [
        { code: 'db.book.findMany({ where: { libraryId: x } })' },
        { code: 'db.book.findFirst({ where: { id, libraryId }, include: { tags: true } })' },
        { code: 'db.book.create({ data: { title: "x" } })' },
        { code: 'db.book.findUnique({ where: { id } })' },
      ],
      invalid: [
        {
          code: 'db.book.findMany()',
          errors: [{ messageId: 'missingWhere' }, { messageId: 'missingLibraryScope' }],
        },
        {
          code: 'db.book.findMany({ orderBy: { title: "asc" } })',
          errors: [{ messageId: 'missingWhere' }, { messageId: 'missingLibraryScope' }],
        },
        {
          code: 'db.book.findFirst({})',
          errors: [{ messageId: 'missingWhere' }, { messageId: 'missingLibraryScope' }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});

describe('no-bare-trpc-procedure', () => {
  it('passes wrappers and rejects bare t.procedure', () => {
    tester.run('no-bare-trpc-procedure', bareTrpcRule, {
      valid: [
        { code: 'authedProcedure.query(() => {})' },
        { code: 'pendingProcedure.mutation(() => {})' },
        { code: 'globalAdminProcedure.query(() => {})' },
        { code: 'publicProcedure.query(() => {})' },
        { code: 't.router({})' },
        { code: 't.middleware(() => {})' },
      ],
      invalid: [
        {
          code: 't.procedure.query(() => {})',
          errors: [{ messageId: 'bareT' }],
        },
        {
          code: 't.procedure.mutation(async () => {})',
          errors: [{ messageId: 'bareT' }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});

describe('no-direct-audit-write', () => {
  it('rejects direct auditLog.create and allows recordAudit', () => {
    tester.run('no-direct-audit-write', directAuditRule, {
      valid: [
        { code: 'recordAudit({ action: "x" })' },
        { code: 'db.book.create({ data: {} })' },
        { code: 'db.user.findFirst({ where: { id } })' },
      ],
      invalid: [
        {
          code: 'db.auditLog.create({ data: {} })',
          errors: [{ messageId: 'direct' }],
        },
        {
          code: 'prisma.auditLog.create({ data: {} })',
          errors: [{ messageId: 'direct' }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
