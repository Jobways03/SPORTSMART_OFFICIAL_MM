-- Phase 2 (2026-06-02): wire a real Delhivery courier path alongside the
-- existing SELF_DELIVERY. Additive enum value — no existing rows change, so
-- this is non-destructive. (Postgres ALTER TYPE ADD VALUE runs outside a
-- transaction; IF NOT EXISTS keeps it safe where already applied.)
ALTER TYPE "DeliveryMethod" ADD VALUE IF NOT EXISTS 'DELHIVERY';
