# HSN_RATE_POLICY.md

**Purpose:** Define how HSN codes and GST rates are sourced, validated, applied, and audited across Sportsmart.

---

## 1. Sourcing

GST rate for an order line is resolved at order-creation time in this order of precedence:

1. **Variant override** — `ProductVariant.gstRateBpsOverride` (if set)
2. **Product-level rate** — `Product.gstRateBps`
3. **HSN master default** — `hsn_master.defaultGstRateBps` (matched by `Product.hsnCode`)
4. **System default** — `DEFAULT_GST_RATE_BPS` (test mode: 1800; strict mode: 0)

In strict mode, fallback to (4) for a `TAXABLE` product is a checkout-block. In test mode it's a warning.

Same precedence for HSN code (variant override → product → no fallback — HSN is required for tax invoice).

Same precedence for UQC (variant override → product → fallback `NOS`).

## 2. HSN code validation rules

- Numeric only. Regex: `^[0-9]+$`.
- Length must match `tax_config.requiredHsnLength` (default 6 — CA-configurable based on AATO).
- Permitted lengths in CBIC: 4, 6, 8.
- Admin UI shows: "Your AATO tier requires X-digit HSN."
- If `Product.hsnCode` exists in `hsn_master`, defaults pre-fill but admin can override.
- If `Product.hsnCode` does NOT exist in `hsn_master`, admin gets a "Use as custom HSN?" prompt.

## 3. HSN ↔ Rate sanity check

When admin sets HSN + GST rate on a product:
- If `Product.gstRateBps != hsn_master.defaultGstRateBps`, show **warning** (not block): "HSN 9506 typically attracts 12% GST; you've set 5%. Confirm before saving."
- Warning logged in audit trail.
- Admin can save anyway with optional reason in `taxCategory`.

## 4. Effective dates

`hsn_master` rows carry `effectiveFrom` + `effectiveTo`. CBIC rate changes mid-year are common; the master supports versioning.

- At order time, resolve rate via the master row where `effectiveFrom <= now < effectiveTo` (or `effectiveTo IS NULL`).
- Historical orders retain their snapshot rate (`OrderTaxLineSnapshot.gstRateBps`) — never recomputed.

## 5. Bulk operations

- Admin UI provides:
  - **Import HSN list** (CSV → `hsn_master` table)
  - **Bulk-apply HSN to category** (sets all products in category to a given HSN+rate)
  - **Bulk-apply HSN to seller** (all of seller's products)
- Every bulk operation creates an audit log per product affected.

## 6. Permissions

- `tax.read` — view HSN master + product tax fields
- `tax.configure` — edit HSN master, product tax fields
- `tax.override` — apply HSN/rate that differs from hsn_master default
- Sellers cannot edit HSN/rate; they request changes, admin approves.

## 7. Stub list seeded (CA must replace)

Engineering has seeded a placeholder `hsn_master` list with ~50 common sports-goods HSN codes (9506, 6203, 6404, etc.) at typical rates. **CA must validate or replace before strict-mode flip.**

Sample seeded entries (visible in DB after migration):
- 9506 → "Articles for general physical exercise, gymnastics, athletics" → 12% → `NOS`
- 9504 → "Video game consoles and machines, articles for funfair, table or parlour games" → 18% → `NOS`
- 6203 → "Men's or boys' suits, ensembles, jackets, blazers, trousers" → 5%/12% (rate-banded by price) → `NOS`
- 6404 → "Footwear with outer soles of rubber, plastics, leather" → 5%/18% (rate-banded by price) → `PRS`
- 4202 → "Trunks, suit-cases, vanity-cases, bags" → 18% → `NOS`

Engineering's seed file: `apps/api/prisma/seed/seed-hsn-master.ts`.

## 8. CA actions required

1. Provide full HSN list signed off for sports-goods catalog.
2. Confirm `tax_config.requiredHsnLength` based on Sportsmart AATO.
3. Confirm price-banded rate handling (e.g. apparel under ₹1000 = 5%, above = 12%) — current schema does NOT support price-band rate; if needed, schema must be extended.
4. Sign off on the bulk-update audit format.

---

**Related:** `GST_ASSUMPTIONS.md` §2, §6; `CA.md` §3 item 10, §4.1.
