-- Phase 1D: Book.archivedAt + searchVector + indexes
-- See docs/superpowers/specs/2026-04-29-phase-1d-design.md §4

-- 1. Soft-delete column (mirrors Library.archivedAt pattern)
ALTER TABLE "Book" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 2. unaccent extension (FR/EN accent-insensitive search)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 3. Immutable wrappers required for GENERATED column expressions
--    unaccent() is STABLE and array_to_string() is STABLE; Postgres requires IMMUTABLE
--    for generated column expressions. The wrappers are safe because output depends
--    only on inputs (no catalog lookups at runtime).
CREATE OR REPLACE FUNCTION unaccent_immutable(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT unaccent($1) $$;

CREATE OR REPLACE FUNCTION array_to_string_immutable(text[], text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT array_to_string($1, $2) $$;

-- 4. tsvector generated column
-- Note: authors is text[] in schema, so we coalesce + array_to_string_immutable
ALTER TABLE "Book" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', unaccent_immutable(coalesce("title", ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent_immutable(coalesce(array_to_string_immutable("authors", ' '), ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent_immutable(coalesce("description", ''))), 'C') ||
    setweight(to_tsvector('simple', unaccent_immutable(coalesce("publisher", ''))), 'D')
  ) STORED;

-- 5. Indexes
CREATE INDEX "Book_searchVector_gin_idx" ON "Book" USING GIN ("searchVector");
CREATE INDEX "Book_libraryId_archivedAt_idx" ON "Book" ("libraryId", "archivedAt");
