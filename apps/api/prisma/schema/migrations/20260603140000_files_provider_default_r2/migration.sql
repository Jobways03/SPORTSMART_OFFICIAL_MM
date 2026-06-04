-- R2 migration — the default object-storage provider is now Cloudflare R2
-- (S3-compatible) instead of the former 's3'. Existing rows are unchanged
-- (uploadDirect rows are 'cloudinary'; the default only applies to inserts
-- that omit the column).
ALTER TABLE "file_metadata" ALTER COLUMN "provider" SET DEFAULT 'r2';
