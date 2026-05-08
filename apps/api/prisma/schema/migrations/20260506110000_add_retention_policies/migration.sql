-- ============================================
-- Phase 7 (PR 7.2) — Retention policies + execution audit
-- ============================================

CREATE TYPE "RetentionAction" AS ENUM ('DELETE', 'ARCHIVE', 'REDACT');

CREATE TABLE "retention_policies" (
    "id"             TEXT             NOT NULL,
    "resource_type"  TEXT             NOT NULL,
    "purpose"        TEXT             NOT NULL DEFAULT '*',
    "retain_days"    INTEGER          NOT NULL,
    "action"         "RetentionAction" NOT NULL DEFAULT 'DELETE',
    "enabled"        BOOLEAN          NOT NULL DEFAULT true,
    "description"    TEXT,
    "created_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retention_policies_resource_type_purpose_key"
    ON "retention_policies" ("resource_type", "purpose");

CREATE INDEX "retention_policies_enabled_idx"
    ON "retention_policies" ("enabled");

CREATE TABLE "retention_executions" (
    "id"                  TEXT             NOT NULL,
    "policy_id"           TEXT             NOT NULL,
    "resource_type"       TEXT             NOT NULL,
    "resource_id"         TEXT             NOT NULL,
    "action"              "RetentionAction" NOT NULL,
    "legal_hold"          BOOLEAN          NOT NULL DEFAULT false,
    "legal_hold_reason"   TEXT,
    "executed_at"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retention_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retention_executions_policy_id_idx"
    ON "retention_executions" ("policy_id");
CREATE INDEX "retention_executions_resource_type_resource_id_idx"
    ON "retention_executions" ("resource_type", "resource_id");
CREATE INDEX "retention_executions_executed_at_idx"
    ON "retention_executions" ("executed_at");
