-- CreateTable
CREATE TABLE "franchise_partner_registrations" (
    "id" TEXT NOT NULL,
    "franchise_id" TEXT NOT NULL,
    "partner" VARCHAR(32) NOT NULL,
    "warehouse_name" VARCHAR(128),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "registered_at" TIMESTAMP(3),
    "registered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_partner_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "franchise_partner_registrations_franchise_id_partner_key" ON "franchise_partner_registrations"("franchise_id", "partner");

-- CreateIndex
CREATE INDEX "franchise_partner_registrations_franchise_id_idx" ON "franchise_partner_registrations"("franchise_id");

-- CreateIndex
CREATE INDEX "franchise_partner_registrations_partner_status_idx" ON "franchise_partner_registrations"("partner", "status");

-- AddForeignKey
ALTER TABLE "franchise_partner_registrations" ADD CONSTRAINT "franchise_partner_registrations_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
