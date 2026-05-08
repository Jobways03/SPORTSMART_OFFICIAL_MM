-- ============================================
-- Phase 4 (PR 4.4) — AuthorizationAudit table
-- ============================================
-- Every guard decision (PermissionsGuard, PolicyGuard, future layers)
-- is buffered by AuthorizationAuditService and flushed in batches.
-- Indexed for the four most common pivot queries during incidents:
-- by actor, by decision over time, by route, and by resource/action.

CREATE TYPE "AuthorizationLayer" AS ENUM ('PERMISSIONS', 'POLICY');
CREATE TYPE "AuthorizationDecisionEffect" AS ENUM ('ALLOW', 'DENY');

CREATE TABLE "authorization_audits" (
    "id"                    TEXT         NOT NULL,
    "admin_id"              TEXT,
    "actor_role"            TEXT,
    "actor_roles"           TEXT[]       NOT NULL DEFAULT '{}',
    "route_label"           TEXT         NOT NULL,
    "method"                TEXT,
    "path"                  TEXT,
    "ip_address"            TEXT,
    "user_agent"            TEXT,
    "request_id"            TEXT,
    "layer"                 "AuthorizationLayer" NOT NULL,
    "decision"              "AuthorizationDecisionEffect" NOT NULL,
    "would_have_blocked"    BOOLEAN      NOT NULL DEFAULT false,
    "required_permissions"  TEXT[]       NOT NULL DEFAULT '{}',
    "resource_type"         TEXT,
    "action"                TEXT,
    "matched_policy_id"     TEXT,
    "matched_policy_name"   TEXT,
    "context"               JSONB,
    "reason"                TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "authorization_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "authorization_audits_admin_id_created_at_idx"
    ON "authorization_audits" ("admin_id", "created_at");

CREATE INDEX "authorization_audits_decision_created_at_idx"
    ON "authorization_audits" ("decision", "created_at");

CREATE INDEX "authorization_audits_route_label_created_at_idx"
    ON "authorization_audits" ("route_label", "created_at");

CREATE INDEX "authorization_audits_resource_type_action_created_at_idx"
    ON "authorization_audits" ("resource_type", "action", "created_at");
