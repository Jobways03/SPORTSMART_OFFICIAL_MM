-- Drop the discount approval workflow + budget enforcement that were
-- removed from the codebase. Per-row pre-drop check at migration
-- authoring time confirmed zero data in any of these columns or the
-- two doomed enum values, so this is a clean structural cleanup with
-- no data loss.
--
-- Three things to undo from migration 20260508160000_p2_discount_approval_budget:
--
--   1. Six approval columns + three budget columns on `discounts`
--   2. The `DiscountBudgetMode` enum (no remaining references)
--   3. Two unused values on `DiscountStatus` (PENDING_APPROVAL, REJECTED)
--
-- Postgres enum-value drops require recreating the type, so #3 is the
-- biggest hop. Done in three steps inside a transaction: create new
-- type without the dead values → swap the column over → drop the old
-- type and rename. The `status_idx` is dropped + recreated to follow.

BEGIN;

-- 1. Drop the columns. ALL of these are no-data-loss (verified before
--    authoring this migration).
ALTER TABLE "discounts"
  DROP COLUMN IF EXISTS "requires_approval",
  DROP COLUMN IF EXISTS "approved_by",
  DROP COLUMN IF EXISTS "approved_at",
  DROP COLUMN IF EXISTS "rejected_by",
  DROP COLUMN IF EXISTS "rejected_at",
  DROP COLUMN IF EXISTS "rejection_reason",
  DROP COLUMN IF EXISTS "budget_total_paise",
  DROP COLUMN IF EXISTS "budget_spent_paise",
  DROP COLUMN IF EXISTS "budget_mode";

-- 2. The DiscountBudgetMode enum has no remaining users after the
--    column drop above. Drop the whole type.
DROP TYPE IF EXISTS "DiscountBudgetMode";

-- 3. Shrink DiscountStatus to remove PENDING_APPROVAL + REJECTED.
--    Postgres can't drop enum values in place, so:
--      a) create the new enum
--      b) drop the index that mentions the column
--      c) cast the column to text, then back to the new enum
--      d) drop the old enum, rename new → old
--      e) re-add the index + default
CREATE TYPE "DiscountStatus_new" AS ENUM ('ACTIVE', 'SCHEDULED', 'EXPIRED', 'DRAFT');

ALTER TABLE "discounts"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "discounts"
  ALTER COLUMN "status" TYPE "DiscountStatus_new"
  USING "status"::text::"DiscountStatus_new";

ALTER TABLE "discounts"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"DiscountStatus_new";

DROP TYPE "DiscountStatus";

ALTER TYPE "DiscountStatus_new" RENAME TO "DiscountStatus";

COMMIT;
