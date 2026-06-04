-- CreateEnum
CREATE TYPE "Partner" AS ENUM ('DELHIVERY', 'SHADOWFAX');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NDR', 'RTO_INITIATED', 'RTO_IN_TRANSIT', 'RTO_DELIVERED', 'CANCELLED', 'LOST', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_WAREHOUSE', 'QC_PASSED', 'QC_FAILED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NdrAction" AS ENUM ('REATTEMPT', 'RESCHEDULE', 'RETURN_TO_ORIGIN', 'HOLD_AT_HUB');

-- CreateEnum
CREATE TYPE "QcOutcome" AS ENUM ('PASS', 'FAIL', 'PARTIAL');

-- CreateTable
CREATE TABLE "cod_remittances" (
    "id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "utr_number" TEXT,
    "remitted_at" TIMESTAMP(3) NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "expected_amount_paise" BIGINT NOT NULL,
    "variance_reason" TEXT,
    "awb_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_remittance_lines" (
    "id" TEXT NOT NULL,
    "remittance_id" TEXT NOT NULL,
    "awb" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "cod_remittance_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "response_status" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ndr_attempts" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "reason_code" TEXT NOT NULL,
    "action_taken" "NdrAction" NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "outcome" TEXT,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ndr_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_health" (
    "id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "booking_success_rate" DOUBLE PRECISION NOT NULL,
    "avg_pickup_hours" DOUBLE PRECISION,
    "avg_delivery_days" DOUBLE PRECISION,
    "rto_rate" DOUBLE PRECISION,
    "ndr_rate" DOUBLE PRECISION,
    "samples" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_records" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "inspector_id" TEXT NOT NULL,
    "outcome" "QcOutcome" NOT NULL,
    "notes" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT,
    "order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "reverse_awb" TEXT,
    "reverse_partner" TEXT,
    "pickup_scheduled_at" TIMESTAMP(3),
    "pickup_address_snapshot" JSONB NOT NULL,
    "qc_record_id" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rto_attempts" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "returned_at" TIMESTAMP(3),
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rto_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "awb" TEXT,
    "carrier_order_ref" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "weight_grams" INTEGER NOT NULL,
    "dims_cm" JSONB NOT NULL,
    "declared_value_paise" BIGINT NOT NULL,
    "cod" BOOLEAN NOT NULL DEFAULT false,
    "cod_amount_paise" BIGINT,
    "pickup_address_snapshot" JSONB NOT NULL,
    "drop_address_snapshot" JSONB NOT NULL,
    "label_url" TEXT,
    "tracking_url" TEXT,
    "booked_at" TIMESTAMP(3),
    "last_tracking_event_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_status_code" TEXT NOT NULL,
    "normalized_status" TEXT NOT NULL,
    "event_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "raw_headers" JSONB NOT NULL,
    "raw_body" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "processing_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cod_remittances_partner_remitted_at_idx" ON "cod_remittances"("partner", "remitted_at");

-- CreateIndex
CREATE INDEX "cod_remittances_utr_number_idx" ON "cod_remittances"("utr_number");

-- CreateIndex
CREATE INDEX "cod_remittance_lines_awb_idx" ON "cod_remittance_lines"("awb");

-- CreateIndex
CREATE UNIQUE INDEX "cod_remittance_lines_remittance_id_awb_key" ON "cod_remittance_lines"("remittance_id", "awb");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "ndr_attempts_shipment_id_attempt_number_idx" ON "ndr_attempts"("shipment_id", "attempt_number");

-- CreateIndex
CREATE INDEX "ndr_attempts_scheduled_for_idx" ON "ndr_attempts"("scheduled_for");

-- CreateIndex
CREATE INDEX "partner_health_partner_window_start_idx" ON "partner_health"("partner", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "partner_health_partner_zone_window_start_key" ON "partner_health"("partner", "zone", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "qc_records_return_id_key" ON "qc_records"("return_id");

-- CreateIndex
CREATE INDEX "qc_records_outcome_created_at_idx" ON "qc_records"("outcome", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "returns_qc_record_id_key" ON "returns"("qc_record_id");

-- CreateIndex
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");

-- CreateIndex
CREATE INDEX "returns_sub_order_id_idx" ON "returns"("sub_order_id");

-- CreateIndex
CREATE INDEX "returns_reverse_awb_idx" ON "returns"("reverse_awb");

-- CreateIndex
CREATE INDEX "returns_status_created_at_idx" ON "returns"("status", "created_at");

-- CreateIndex
CREATE INDEX "rto_attempts_shipment_id_idx" ON "rto_attempts"("shipment_id");

-- CreateIndex
CREATE INDEX "rto_attempts_status_created_at_idx" ON "rto_attempts"("status", "created_at");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_sub_order_id_idx" ON "shipments"("sub_order_id");

-- CreateIndex
CREATE INDEX "shipments_awb_idx" ON "shipments"("awb");

-- CreateIndex
CREATE INDEX "shipments_partner_status_idx" ON "shipments"("partner", "status");

-- CreateIndex
CREATE INDEX "shipments_last_tracking_event_at_idx" ON "shipments"("last_tracking_event_at");

-- CreateIndex
CREATE INDEX "tracking_events_shipment_id_event_at_idx" ON "tracking_events"("shipment_id", "event_at");

-- CreateIndex
CREATE INDEX "tracking_events_partner_partner_status_code_idx" ON "tracking_events"("partner", "partner_status_code");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_dedup_key_key" ON "webhook_events"("dedup_key");

-- CreateIndex
CREATE INDEX "webhook_events_partner_created_at_idx" ON "webhook_events"("partner", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events"("processed_at");

-- AddForeignKey
ALTER TABLE "cod_remittance_lines" ADD CONSTRAINT "cod_remittance_lines_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "cod_remittances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ndr_attempts" ADD CONSTRAINT "ndr_attempts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rto_attempts" ADD CONSTRAINT "rto_attempts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
