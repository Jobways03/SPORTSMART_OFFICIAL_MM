-- ============================================
-- Phase 6 (PR 6.1) — SLA policies + breaches
-- ============================================

CREATE TABLE "sla_policies" (
    "id"                                TEXT         NOT NULL,
    "name"                              TEXT         NOT NULL,
    "description"                       TEXT,
    "resource_type"                     TEXT         NOT NULL,
    "status"                            TEXT         NOT NULL,
    "deadline_minutes"                  INTEGER      NOT NULL,
    "warning_minutes_before_deadline"   INTEGER,
    "escalate_after_minutes"            INTEGER,
    "escalate_action"                   TEXT,
    "enabled"                           BOOLEAN      NOT NULL DEFAULT true,
    "created_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sla_policies_resource_type_status_name_key"
    ON "sla_policies" ("resource_type", "status", "name");

CREATE INDEX "sla_policies_resource_type_status_enabled_idx"
    ON "sla_policies" ("resource_type", "status", "enabled");

CREATE TABLE "sla_breaches" (
    "id"                  TEXT         NOT NULL,
    "policy_id"           TEXT         NOT NULL,
    "resource_type"       TEXT         NOT NULL,
    "resource_id"         TEXT         NOT NULL,
    "status"              TEXT         NOT NULL,
    "entered_status_at"   TIMESTAMP(3) NOT NULL,
    "deadline_at"         TIMESTAMP(3) NOT NULL,
    "breached_at"         TIMESTAMP(3) NOT NULL,
    "escalated_at"        TIMESTAMP(3),
    "resolved_at"         TIMESTAMP(3),
    "overdue_minutes"     INTEGER,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sla_breaches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sla_breaches_policy_id_fkey"
        FOREIGN KEY ("policy_id")
        REFERENCES "sla_policies" ("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sla_breaches_policy_resource_key"
    ON "sla_breaches" ("policy_id", "resource_type", "resource_id");

CREATE INDEX "sla_breaches_resource_type_resource_id_idx"
    ON "sla_breaches" ("resource_type", "resource_id");

CREATE INDEX "sla_breaches_resolved_at_idx"
    ON "sla_breaches" ("resolved_at");

CREATE INDEX "sla_breaches_breached_at_idx"
    ON "sla_breaches" ("breached_at");
