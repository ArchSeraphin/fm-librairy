# Runbook — Hard delete a Book (GLOBAL_ADMIN, DBA-scoped)

## When to use this

Use when a Book row must be removed permanently:

- Legal takedown (DMCA, GDPR right-to-erasure that scope-archive cannot satisfy).
- Data corruption requiring a clean replacement.

For any other case, **archive instead** (`library.books.archive`). Archive
is reversible; hard delete is not.

## Pre-flight

1. Confirm the actor is GLOBAL_ADMIN with 2FA active.
2. Note the `bookId`, the `libraryId`, and the requesting user/legal reference.
3. Inspect dependencies:

   ```sql
   SELECT
     (SELECT COUNT(*) FROM "BookFile" WHERE "bookId" = '<id>') AS files,
     (SELECT COUNT(*) FROM "PhysicalCopy" WHERE "bookId" = '<id>') AS copies,
     (SELECT COUNT(*) FROM "Annotation" WHERE "bookId" = '<id>') AS annotations,
     (SELECT COUNT(*) FROM "Bookmark" WHERE "bookId" = '<id>') AS bookmarks,
     (SELECT COUNT(*) FROM "ReadingProgress" WHERE "bookId" = '<id>') AS progress,
     (SELECT COUNT(*) FROM "ReadingSession" WHERE "bookId" = '<id>') AS sessions,
     (SELECT COUNT(*) FROM "BookTag" WHERE "bookId" = '<id>') AS tags;
   ```

4. **If any non-zero count exists**, the API will refuse with `BAD_REQUEST`. Choose:
   - For `files`: delete file rows + the on-disk artifacts (Phase 2+ runbook needed).
   - For `copies`: delete the PhysicalCopy rows manually after consulting their owners.
   - For `annotations / bookmarks / progress / sessions`: these are user-private. Manually delete only after legal review (they belong to other users).
   - For `tags`: harmless to delete.

## Action

```bash
# tRPC call (recommended; emits audit log automatically)
pnpm tsx scripts/admin/delete-book.ts <librarySlug> <bookId>
```

Or via SQL (last resort, **does not emit audit log**):

```sql
DELETE FROM "Book" WHERE "id" = '<bookId>';
```

## Post-flight

1. Confirm the audit log entry: `SELECT * FROM "AuditLog" WHERE action = 'library.book.deleted' AND "targetId" = '<bookId>';`
2. Document the operation in your team's incident log with the legal reference.
3. If files were deleted from disk, verify they're gone from backup retention windows that fall under the legal mandate.

## Why this is gated

Hard delete is irreversible and bypasses the soft-delete safety net. The
runbook + GLOBAL_ADMIN-only API enforces a manual decision point.
