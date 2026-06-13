-- Dynamic settlement tax/charge rule master. Admin-configurable rules
-- (rate_bps applied to a base: PRICE_OF_GOODS_SOLD | COMMISSION | RULE).
-- Rule-master only for now; the settlement calculation that consumes these
-- rules is a later phase. Hand-authored (dev DB has pre-existing drift, so
-- applied via `migrate deploy` / direct apply rather than `migrate dev`).

CREATE TABLE "settlement_charge_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "base_type" TEXT NOT NULL,
    "base_rule_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_charge_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "settlement_charge_rules_status_effective_from_idx" ON "settlement_charge_rules"("status", "effective_from");

CREATE INDEX "settlement_charge_rules_base_rule_id_idx" ON "settlement_charge_rules"("base_rule_id");
