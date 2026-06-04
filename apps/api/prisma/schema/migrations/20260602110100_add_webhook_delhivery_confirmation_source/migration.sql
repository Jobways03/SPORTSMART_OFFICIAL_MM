-- Phase 3 Delhivery wiring (2026-06-02)
-- Delhivery tracking webhook (POST /shipping/webhooks/delhivery) confirms
-- delivery; the SubOrder.deliverSource column records the channel.
-- ADD VALUE is additive and cannot run inside a transaction block.
ALTER TYPE "DeliveryConfirmationSource" ADD VALUE IF NOT EXISTS 'WEBHOOK_DELHIVERY';
