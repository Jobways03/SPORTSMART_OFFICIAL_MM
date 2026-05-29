-- Phase 91 (2026-05-23) — Shipping Options enum extension + new enums.
--
-- Extends ShippingRateType with SLAB. New enums for surcharge kind +
-- value-type live here because Postgres needs ALTER TYPE in its own
-- migration (cannot share tx with table DDL).

ALTER TYPE "ShippingRateType" ADD VALUE IF NOT EXISTS 'SLAB';

CREATE TYPE "ShippingSurchargeKind" AS ENUM (
  'COD',
  'FUEL',
  'REMOTE_AREA',
  'WEEKEND',
  'OVERSIZED',
  'OVERWEIGHT',
  'INSURANCE',
  'RETURN'
);

CREATE TYPE "ShippingSurchargeValueType" AS ENUM (
  'FLAT_PAISE',
  'PERCENT_BPS'
);
