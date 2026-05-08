-- Phase 1.5 — Business-duplicate detection audit table (ADR-006).
-- Behaviour off by default until CASE_DUPLICATE_PREVENTION_ENABLED=true.

-- CreateEnum
CREATE TYPE "DuplicateSourceType" AS ENUM ('RETURN', 'DISPUTE', 'TICKET');

-- CreateTable
CREATE TABLE "case_duplicates" (
    "id"                      TEXT NOT NULL,
    "attempted_source_type"   "DuplicateSourceType" NOT NULL,
    "attempted_natural_key"   JSONB NOT NULL,
    "duplicate_of_source_type" "DuplicateSourceType" NOT NULL,
    "duplicate_of_source_id"  TEXT NOT NULL,
    "reason"                  TEXT NOT NULL,
    "actor_type"              TEXT NOT NULL,
    "actor_id"                TEXT NOT NULL,
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_duplicates_attempted_source_type_created_at_idx"
  ON "case_duplicates"("attempted_source_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "case_duplicates_duplicate_of_source_type_duplicate_of_source_id_idx"
  ON "case_duplicates"("duplicate_of_source_type", "duplicate_of_source_id");

-- CreateIndex
CREATE INDEX "case_duplicates_actor_type_actor_id_created_at_idx"
  ON "case_duplicates"("actor_type", "actor_id", "created_at" DESC);
