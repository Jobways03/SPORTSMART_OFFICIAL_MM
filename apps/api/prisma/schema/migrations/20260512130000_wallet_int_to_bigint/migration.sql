-- Phase 2 (PR 2.2) — widen wallet money columns from INTEGER to BIGINT.
--
-- INTEGER's signed max is 2,147,483,647 paise (~₹21,474,836). For a
-- single retail customer that's a lifetime; for B2B franchise wallets,
-- admin goodwill credit batches, or promo-engine top-ups it's reachable.
-- The wraparound on INT overflow in Postgres is a hard error
-- (`integer out of range`), so the user-facing failure mode is "credit
-- failed for opaque reason" — a silent-but-disruptive bug rather than
-- silent corruption.
--
-- Postgres widens INT→BIGINT in-place via a metadata-only change when
-- there's no rewriting required; the catalog flips and existing values
-- are preserved bit-for-bit (every INT fits inside a BIGINT). No table
-- rewrite, no extended lock. On large tables the ALTER takes ms.
--
-- The TypeScript repo layer marshals between bigint (storage) and
-- number (in-memory) at the boundary — see WalletEntity in the repo
-- interface — so service-level callers keep using `number` and stay
-- within JS's 2^53-1 safe-integer range (₹90 trillion).

ALTER TABLE "wallets"
  ALTER COLUMN "balance_in_paise" TYPE BIGINT;

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "amount_in_paise" TYPE BIGINT,
  ALTER COLUMN "balance_after_in_paise" TYPE BIGINT;
