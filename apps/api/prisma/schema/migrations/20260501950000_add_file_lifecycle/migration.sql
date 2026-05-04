-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY', 'DELETED');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM (
  'KYC_DOCUMENT', 'BANK_PROOF', 'QC_EVIDENCE', 'DISPUTE_EVIDENCE',
  'INVOICE', 'PRODUCT_IMAGE', 'PRODUCT_VIDEO', 'BANNER', 'AVATAR',
  'TICKET_ATTACHMENT', 'OTHER'
);

-- AlterTable
ALTER TABLE "file_metadata"
  ADD COLUMN "purpose" "FilePurpose" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 's3',
  ADD COLUMN "provider_file_id" TEXT,
  ADD COLUMN "provider_url" TEXT,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows are presumed already-uploaded → mark READY.
UPDATE "file_metadata" SET "status" = 'READY' WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "file_metadata_status_idx" ON "file_metadata"("status");
CREATE INDEX "file_metadata_purpose_idx" ON "file_metadata"("purpose");
CREATE INDEX "file_metadata_deleted_at_idx" ON "file_metadata"("deleted_at");

-- AlterTable
ALTER TABLE "file_attachments"
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "attached_by" TEXT;

-- CreateIndex
CREATE INDEX "file_attachments_file_id_idx" ON "file_attachments"("file_id");
