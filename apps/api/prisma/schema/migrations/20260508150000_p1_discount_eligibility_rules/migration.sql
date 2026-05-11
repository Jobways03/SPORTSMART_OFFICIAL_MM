-- Phase E (P1.3) — Discount eligibility rules.
--
-- One row per rule on a discount. A discount with no rows is
-- unrestricted — same as before this table existed (legacy compat).
--
-- The rule_type enum + operator + value_json design is deliberately
-- generic so we can add new rule types (e.g. payment-method, region)
-- without further schema changes — only the evaluator updates.
--
-- value_json carries the typed payload; shape per rule_type:
--   FIRST_ORDER_ONLY            → {} (no params)
--   NEW_CUSTOMER_ONLY           → { "maxAccountAgeDays": 30 }
--   CUSTOMER_TIER_IN            → { "tiers": ["GOLD", "PLATINUM"] }
--   CUSTOMER_SEGMENT_IN         → { "segments": [...] }
--   SELLER_IN                   → { "sellerIds": [...] }
--   CATEGORY_IN                 → { "categoryIds": [...] }
--   PRODUCT_IN                  → { "productIds": [...] }
--   COLLECTION_IN               → { "collectionIds": [...] }
--   PAYMENT_METHOD_IN           → { "methods": ["RAZORPAY", "COD"] }
--   CITY_IN                     → { "cities": [...] }
--   PINCODE_IN                  → { "pincodes": [...] }
--   MIN_CART_VALUE              → { "minPaise": 50000 }
--   MIN_ELIGIBLE_ITEM_QUANTITY  → { "minQuantity": 2 }
--   MAX_REDEMPTIONS_PER_CUSTOMER       → { "max": 3 }
--   MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW → { "max": 3, "windowDays": 30 }
--   MIN_DAYS_BETWEEN_REDEMPTIONS       → { "days": 7 }
--
-- The evaluator runs server-side on every coupon validate /
-- reservation. Each rule contributes a yes/no answer with a
-- customer-friendly rejection reason; the first failure short-
-- circuits and is returned to the customer.

CREATE TYPE "DiscountEligibilityRuleType" AS ENUM (
  'FIRST_ORDER_ONLY',
  'NEW_CUSTOMER_ONLY',
  'CUSTOMER_TIER_IN',
  'CUSTOMER_SEGMENT_IN',
  'SELLER_IN',
  'CATEGORY_IN',
  'PRODUCT_IN',
  'COLLECTION_IN',
  'PAYMENT_METHOD_IN',
  'CITY_IN',
  'PINCODE_IN',
  'MIN_CART_VALUE',
  'MIN_ELIGIBLE_ITEM_QUANTITY',
  'MAX_REDEMPTIONS_PER_CUSTOMER',
  'MAX_REDEMPTIONS_PER_CUSTOMER_WINDOW',
  'MIN_DAYS_BETWEEN_REDEMPTIONS'
);

CREATE TABLE "discount_eligibility_rules" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "rule_type" "DiscountEligibilityRuleType" NOT NULL,
    -- Operator currently unused (always implicit per rule_type) but
    -- kept on the schema so future rules like
    -- MIN_CART_VALUE_GREATER_OR_EQUAL vs _GREATER_THAN can land
    -- without a migration.
    "operator" TEXT,
    "value_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_eligibility_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discount_eligibility_rules_discount_id_idx"
  ON "discount_eligibility_rules"("discount_id");
CREATE INDEX "discount_eligibility_rules_rule_type_idx"
  ON "discount_eligibility_rules"("rule_type");

ALTER TABLE "discount_eligibility_rules"
  ADD CONSTRAINT "discount_eligibility_rules_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
