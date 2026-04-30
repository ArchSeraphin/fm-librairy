-- Add libraryId nullable, backfill from Book, set NOT NULL, add FK + unique
ALTER TABLE "BookFile" ADD COLUMN "libraryId" TEXT;

UPDATE "BookFile" bf
SET "libraryId" = b."libraryId"
FROM "Book" b
WHERE bf."bookId" = b.id;

ALTER TABLE "BookFile" ALTER COLUMN "libraryId" SET NOT NULL;

ALTER TABLE "BookFile"
  ADD CONSTRAINT "BookFile_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "Library"(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX "BookFile_libraryId_sha256_key"
  ON "BookFile"("libraryId", "sha256");

CREATE INDEX "BookFile_libraryId_idx" ON "BookFile"("libraryId");
