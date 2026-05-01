-- CreateEnum
CREATE TYPE "MetadataFetchStatus" AS ENUM ('PENDING', 'FETCHED', 'NOT_FOUND', 'ERROR');

-- AlterTable
ALTER TABLE "Book"
  ADD COLUMN "metadataFetchStatus" "MetadataFetchStatus",
  ADD COLUMN "metadataFetchedAt" TIMESTAMP(3),
  ADD COLUMN "metadataAttemptCount" INTEGER NOT NULL DEFAULT 0;
