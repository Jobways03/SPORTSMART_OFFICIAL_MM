-- Phase 3 Delhivery wiring (2026-06-02)
-- Auto-booked Delhivery AWBs are recorded with a distinct provenance
-- (system actor) rather than masquerading as ADMIN_OVERRIDE.
-- ADD VALUE is additive and cannot run inside a transaction block.
ALTER TYPE "AwbAttachmentSource" ADD VALUE IF NOT EXISTS 'DELHIVERY_BOOKING';
