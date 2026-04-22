/*
  Warnings:

  - Made the column `from_seller_id` on table `order_reassignment_logs` required. This step will fail if there are existing NULL values in that column.
  - Made the column `reason` on table `order_reassignment_logs` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "commission_records" ALTER COLUMN "platform_price" DROP DEFAULT,
ALTER COLUMN "settlement_price" DROP DEFAULT,
ALTER COLUMN "total_platform_amount" DROP DEFAULT,
ALTER COLUMN "total_settlement_amount" DROP DEFAULT,
ALTER COLUMN "platform_margin" DROP DEFAULT;

-- AlterTable
ALTER TABLE "commission_settings" ALTER COLUMN "commission_type" SET DEFAULT 'MARGIN_BASED';

-- AlterTable
ALTER TABLE "order_reassignment_logs" ALTER COLUMN "from_seller_id" SET NOT NULL,
ALTER COLUMN "reason" SET NOT NULL,
ALTER COLUMN "successful" DROP DEFAULT;

-- AlterTable
ALTER TABLE "post_offices" ALTER COLUMN "latitude" SET DATA TYPE DECIMAL(12,7),
ALTER COLUMN "longitude" SET DATA TYPE DECIMAL(12,7);

-- RenameIndex
ALTER INDEX "settlement_cycles_period_idx" RENAME TO "settlement_cycles_period_start_period_end_idx";
