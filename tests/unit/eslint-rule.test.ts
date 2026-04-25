import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-unscoped-prisma.js';

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-unscoped-prisma', () => {
  it('passes valid and rejects invalid', () => {
    tester.run('no-unscoped-prisma', rule, {
      valid: [
        { code: 'db.book.findMany({ where: { libraryId: x } })' },
        { code: 'db.book.findFirst({ where: { id }, include: { tags: true } })' },
        { code: 'db.book.create({ data: { title: "x" } })' },
        { code: 'db.book.findUnique({ where: { id } })' },
      ],
      invalid: [
        {
          code: 'db.book.findMany()',
          errors: [{ messageId: 'missingWhere' }],
        },
        {
          code: 'db.book.findMany({ orderBy: { title: "asc" } })',
          errors: [{ messageId: 'missingWhere' }],
        },
        {
          code: 'db.book.findFirst({})',
          errors: [{ messageId: 'missingWhere' }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
