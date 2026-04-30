'use strict';

const { RuleTester } = require('eslint');
const rule = require('../no-unscoped-prisma');

const ruleTester = new RuleTester({ parserOptions: { ecmaVersion: 2022, sourceType: 'module' } });

ruleTester.run('no-unscoped-prisma', rule, {
  valid: [
    // Library-scoped models with libraryId present
    'db.book.findMany({ where: { libraryId: "x" } })',
    // findUnique is not in FORBIDDEN_METHODS or SCOPED_METHODS — not flagged
    'db.book.findUnique({ where: { id: "x" } })',
    // User-scoped models with userId present
    'db.annotation.findMany({ where: { userId: "u" } })',
    // Model not in either scope list — no scope-key check
    'db.user.findMany({ where: { id: "u" } })',
    // updateMany with libraryId present in where
    'db.book.updateMany({ where: { libraryId: "x", archivedAt: null }, data: {} })',
  ],
  invalid: [
    // Library-scoped model: where present but missing libraryId
    {
      code: 'db.book.findMany({ where: { title: "x" } })',
      errors: [{ messageId: 'missingLibraryScope', data: { model: 'book' } }],
    },
    // Library-scoped model: no where at all — triggers both missingWhere AND missingLibraryScope
    {
      code: 'db.book.findMany({})',
      errors: [
        { messageId: 'missingWhere', data: { method: 'findMany' } },
        { messageId: 'missingLibraryScope', data: { model: 'book' } },
      ],
    },
    // User-scoped model: where present but missing userId
    {
      code: 'db.bookmark.findMany({ where: { bookId: "b" } })',
      errors: [{ messageId: 'missingUserScope', data: { model: 'bookmark' } }],
    },
    // Library-scoped model: updateMany where present but missing libraryId
    {
      code: 'db.book.updateMany({ where: { id: "x" }, data: {} })',
      errors: [{ messageId: 'missingLibraryScope', data: { model: 'book' } }],
    },
  ],
});

console.log('no-unscoped-prisma: all tests passed');
