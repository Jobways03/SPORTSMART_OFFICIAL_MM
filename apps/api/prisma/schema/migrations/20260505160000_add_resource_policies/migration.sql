-- ============================================
-- Phase 4 (PR 4.3) — ABAC ResourcePolicy table
-- ============================================
-- Stores attribute-based-access-control rules layered on top of the
-- existing role/permission system. Evaluator (PolicyEvaluatorService)
-- consults this table when a route is annotated with @Policy(...).
-- Schema mirrors authorization.prisma exactly; CREATE TABLE statements
-- use double-quoted identifiers to match Prisma's expectations.

CREATE TYPE "PolicyEffect" AS ENUM ('ALLOW', 'DENY');
CREATE TYPE "PolicyPrincipalType" AS ENUM ('ROLE', 'PERMISSION', 'CUSTOM_ROLE', 'ANY');

CREATE TABLE "resource_policies" (
    "id"                   TEXT         NOT NULL,
    "name"                 TEXT         NOT NULL,
    "description"          TEXT,
    "effect"               "PolicyEffect" NOT NULL DEFAULT 'ALLOW',
    "principal_type"       "PolicyPrincipalType" NOT NULL,
    "principal_key"        TEXT         NOT NULL,
    "resource_type"        TEXT         NOT NULL,
    "action"               TEXT         NOT NULL,
    "conditions"           JSONB,
    "priority"             INTEGER      NOT NULL DEFAULT 100,
    "enabled"              BOOLEAN      NOT NULL DEFAULT true,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,
    "created_by_admin_id"  TEXT,
    CONSTRAINT "resource_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resource_policies_name_key"
    ON "resource_policies" ("name");

CREATE INDEX "resource_policies_resource_type_action_enabled_idx"
    ON "resource_policies" ("resource_type", "action", "enabled");

CREATE INDEX "resource_policies_principal_type_principal_key_idx"
    ON "resource_policies" ("principal_type", "principal_key");
