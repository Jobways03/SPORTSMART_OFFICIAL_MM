-- Phase 88 (2026-05-23) — typed ShipmentEvidence + audit log + policy.
--
-- Replaces the polymorphic FileAttachment(resource='sub_order',
-- file.purpose='SHIPMENT_EVIDENCE') lookup with a typed entity that
-- supports FKs, indexed lookups, POD/PACKING differentiation, geo +
-- signature + OTP metadata, chain-of-custody audit, retention, and
-- a per-scope policy table.
--
-- Dual-write strategy: upload still creates the FileAttachment row
-- (legacy readers keep working) but additionally creates a typed
-- ShipmentEvidence row. New readers (4-photo gate, customer POD,
-- admin browsing) read from the typed table.

CREATE TYPE "shipment_evidence_kind_enum" AS ENUM (
  'PACKING',
  'DISPATCH',
  'POD',
  'RTO_PROOF',
  'EXCEPTION',
  'CUSTOMER_REJECT',
  'ADMIN_OVERRIDE',
  'ARCHIVED_REASSIGNMENT'
);

CREATE TYPE "shipment_evidence_actor_enum" AS ENUM (
  'SELLER',
  'FRANCHISE',
  'ADMIN',
  'CUSTOMER',
  'CARRIER_WEBHOOK',
  'SYSTEM'
);

CREATE TABLE "shipment_evidence" (
  "id"                  TEXT PRIMARY KEY,
  "sub_order_id"        TEXT NOT NULL,
  "kind"                "shipment_evidence_kind_enum" NOT NULL,
  "file_id"             TEXT NOT NULL,
  "captured_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploaded_by"         TEXT NOT NULL,
  "uploaded_by_role"    "shipment_evidence_actor_enum" NOT NULL,
  "geo_lat"             DECIMAL(10,7),
  "geo_lng"             DECIMAL(10,7),
  "exif_json"           JSONB,
  "perceptual_hash"     TEXT,
  "content_sha256"      TEXT,
  "courier_waybill"     TEXT,
  "signature_blob"      TEXT,
  "signed_by_name"      TEXT,
  "customer_otp_hash"   TEXT,
  "pending_upload"      BOOLEAN NOT NULL DEFAULT TRUE,
  "frozen_at"           TIMESTAMP(3),
  "retention_expires_at" TIMESTAMP(3),
  "deleted_at"          TIMESTAMP(3),
  "deleted_by"          TEXT,
  "deleted_reason"      TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipment_evidence_sub_order_id_fkey"
    FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE,
  CONSTRAINT "shipment_evidence_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "file_metadata"("id") ON DELETE CASCADE
);

CREATE INDEX "shipment_evidence_sub_order_id_kind_deleted_at_idx"
  ON "shipment_evidence" ("sub_order_id", "kind", "deleted_at");
CREATE INDEX "shipment_evidence_sub_order_id_captured_at_idx"
  ON "shipment_evidence" ("sub_order_id", "captured_at");
CREATE INDEX "shipment_evidence_content_sha256_idx"
  ON "shipment_evidence" ("content_sha256");
CREATE INDEX "shipment_evidence_pending_upload_created_at_idx"
  ON "shipment_evidence" ("pending_upload", "created_at");
CREATE INDEX "shipment_evidence_retention_expires_at_idx"
  ON "shipment_evidence" ("retention_expires_at");

CREATE TABLE "shipment_evidence_audits" (
  "id"                    TEXT PRIMARY KEY,
  "shipment_evidence_id"  TEXT NOT NULL,
  "action"                TEXT NOT NULL,
  "actor_id"              TEXT NOT NULL,
  "actor_role"            "shipment_evidence_actor_enum" NOT NULL,
  "reason"                TEXT,
  "before_json"           JSONB,
  "after_json"            JSONB,
  "ip_address"            TEXT,
  "user_agent"            TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_evidence_audits_evidence_id_fkey"
    FOREIGN KEY ("shipment_evidence_id") REFERENCES "shipment_evidence"("id") ON DELETE CASCADE
);

CREATE INDEX "shipment_evidence_audits_evidence_id_created_at_idx"
  ON "shipment_evidence_audits" ("shipment_evidence_id", "created_at" DESC);
CREATE INDEX "shipment_evidence_audits_actor_id_created_at_idx"
  ON "shipment_evidence_audits" ("actor_id", "created_at");

CREATE TABLE "shipment_evidence_policies" (
  "id"                  TEXT PRIMARY KEY,
  "scope"               TEXT NOT NULL UNIQUE,
  "scope_match"         JSONB NOT NULL,
  "priority"            INTEGER NOT NULL DEFAULT 100,
  "packing_photos_min"  INTEGER NOT NULL DEFAULT 4,
  "pod_required"        BOOLEAN NOT NULL DEFAULT FALSE,
  "signature_required"  BOOLEAN NOT NULL DEFAULT FALSE,
  "otp_required"        BOOLEAN NOT NULL DEFAULT FALSE,
  "retention_days"      INTEGER NOT NULL DEFAULT 180,
  "active"              BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);

CREATE INDEX "shipment_evidence_policies_active_priority_idx"
  ON "shipment_evidence_policies" ("active", "priority");

-- Phase 88 — Gap #17. Composite index on file_attachments to support
-- the existing legacy lookup until dual-write is dropped.
CREATE INDEX "file_attachments_resource_resourceid_createdat_idx"
  ON "file_attachments" ("resource", "resource_id", "created_at");
