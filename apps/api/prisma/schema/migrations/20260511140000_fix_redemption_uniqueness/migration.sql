-- Drop the over-strict partial unique indexes added by migration
-- 20260508130000 (P0 security patches).
--
-- The indexes:
--   discount_redemptions_active_per_customer_code
--   discount_redemptions_active_per_customer_discount
--
-- enforced uniqueness on (discount_*, customer_id) WHERE status IN
-- ('RESERVED', 'REDEEMED'). This assumed every discount is one-per-
-- customer, but Discount.onePerCustomer is a per-row flag — many
-- discounts allow repeat redemptions by the same customer (a 10%
-- evergreen "TEST10", a stackable "FIRST_ORDER" doesn't apply once
-- onePerCustomer=false, etc.).
--
-- The result: a customer who legitimately redeems a non-one-per-
-- customer discount once is forever blocked from redeeming it again,
-- because the second reserve() insert fails with the unique-constraint
-- violation and the reservation service maps that to CONCURRENT_RESERVATION.
--
-- Application-layer enforcement (DiscountReservationService.reserve
-- with FOR UPDATE row-lock on the parent Discount + an explicit count
-- against onePerCustomer) handles this correctly. The indexes were
-- belt-and-suspenders that turned out to enforce the wrong invariant.
--
-- Dropping them brings the database in line with the application
-- contract; correctness is preserved by the row-lock concurrency model.

DROP INDEX IF EXISTS "discount_redemptions_active_per_customer_code";
DROP INDEX IF EXISTS "discount_redemptions_active_per_customer_discount";
