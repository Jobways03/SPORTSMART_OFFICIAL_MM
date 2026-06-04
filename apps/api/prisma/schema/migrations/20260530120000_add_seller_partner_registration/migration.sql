-- CreateTable
CREATE TABLE "seller_partner_registrations" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "partner" VARCHAR(32) NOT NULL,
    "warehouse_name" VARCHAR(128),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "registered_at" TIMESTAMP(3),
    "registered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_partner_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_partner_registrations_seller_id_partner_key" ON "seller_partner_registrations"("seller_id", "partner");

-- CreateIndex
CREATE INDEX "seller_partner_registrations_seller_id_idx" ON "seller_partner_registrations"("seller_id");

-- CreateIndex
CREATE INDEX "seller_partner_registrations_partner_status_idx" ON "seller_partner_registrations"("partner", "status");

-- AddForeignKey
ALTER TABLE "seller_partner_registrations"
    ADD CONSTRAINT "seller_partner_registrations_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
