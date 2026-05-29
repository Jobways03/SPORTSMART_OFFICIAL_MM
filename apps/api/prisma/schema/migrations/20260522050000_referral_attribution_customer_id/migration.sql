-- Phase 62 (2026-05-22) — coupon application hardening.
--
-- 1) referral_attributions.customer_id — backs the self-referral
--    guard (audit Gap #1) and the perUserLimit enforcement query
--    (audit Gap #3). Pre-Phase-62 attribution carried no customer
--    pointer, so the affiliate facade had no way to assert
--    `customerId !== affiliate.userId` at write time.
--
--    Backfill from master_orders.customer_id so existing rows are
--    queryable. Migration is non-blocking — column is nullable to
--    let the backfill complete on a populated DB without locking
--    the table.
ALTER TABLE "referral_attributions"
  ADD COLUMN "customer_id" TEXT;

UPDATE "referral_attributions" ra
SET "customer_id" = mo."customer_id"
FROM "master_orders" mo
WHERE mo."id" = ra."order_id" AND ra."customer_id" IS NULL;

CREATE INDEX "referral_attributions_code_affiliate_customer_idx"
  ON "referral_attributions"("code", "affiliate_id", "customer_id");

-- 2) coupon_attempts.ip_hash — Phase 62 (audit Gap #21) replaces
--    plaintext IP storage on retained logs with a salted SHA-256
--    digest. The existing ip_address column is kept nullable so the
--    write path can hash + leave the old column blank; the cleanup
--    cron will nullify any backlogged plaintext rows.
ALTER TABLE "coupon_attempts"
  ADD COLUMN "ip_hash" TEXT;

CREATE INDEX "coupon_attempts_ip_hash_created_at_idx"
  ON "coupon_attempts"("ip_hash", "created_at");
