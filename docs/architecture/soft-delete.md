# Architecture — Soft delete

## Pattern

Sensitive entities use `archivedAt: DateTime?` (nullable). Setting it
hides the entity from non-admin views; clearing it restores it. Hard
deletion is reserved for GLOBAL_ADMIN with a runbook.

## Entities using the pattern

| Entity   | `archivedAt` since |
|----------|---------------------|
| Library  | Phase 1C            |
| Book     | Phase 1D            |
| (BookFile, PhysicalCopy: TBD when Phase 2 lands) |

## Invariants

- Non-admin reads (list/get) MUST filter out `archivedAt != null`.
- Admin reads MAY opt in via `includeArchived: true`.
- Mutations (update, archive) MUST refuse if already archived
  (`BAD_REQUEST`) — surfacing UI mistakes.
- Unarchive MUST refuse if not archived (symmetry).
- Hard delete (where supported) MUST refuse if dependent rows exist
  (BookFile, PhysicalCopy, etc.).

## How to add the pattern to a new model

1. Add `archivedAt DateTime?` to the Prisma model.
2. Add `@@index([..., archivedAt])` for the most common scope key.
3. In every list/get procedure, branch on `isAdmin` to decide whether
   to filter.
4. Add `archive` and `unarchive` mutations symmetrically.
5. Add the new procedures to the permissions matrix.

## Future cleanup

A scheduled job that hard-deletes archived rows older than N months
could reclaim space. Not implemented as of Phase 1D — the dataset is
small (~2k rows expected by year 1).
