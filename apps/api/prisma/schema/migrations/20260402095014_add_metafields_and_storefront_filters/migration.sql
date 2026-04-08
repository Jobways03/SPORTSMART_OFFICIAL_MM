/*
  Warnings:

  - Made the column `from_seller_id` on table `order_reassignment_logs` required. This step will fail if there are existing NULL values in that column.
  - Made the column `reason` on table `order_reassignment_logs` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "MetafieldType" AS ENUM ('SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'NUMBER_INTEGER', 'NUMBER_DECIMAL', 'BOOLEAN', 'DATE', 'COLOR', 'URL', 'DIMENSION', 'WEIGHT', 'VOLUME', 'RATING', 'JSON', 'SINGLE_SELECT', 'MULTI_SELECT', 'FILE_REFERENCE');

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

-- CreateTable
CREATE TABLE "metafield_definitions" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "MetafieldType" NOT NULL,
    "validations" JSONB,
    "choices" JSONB,
    "owner_type" TEXT NOT NULL DEFAULT 'CATEGORY',
    "category_id" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metafield_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_metafields" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "metafield_definition_id" TEXT NOT NULL,
    "value_text" TEXT,
    "value_numeric" DECIMAL(15,4),
    "value_boolean" BOOLEAN,
    "value_date" TIMESTAMP(3),
    "value_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_metafields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_filters" (
    "id" TEXT NOT NULL,
    "metafield_definition_id" TEXT,
    "built_in_type" TEXT,
    "label" TEXT NOT NULL,
    "filter_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "scope_type" TEXT,
    "scope_id" TEXT,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "show_counts" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metafield_definitions_category_id_idx" ON "metafield_definitions"("category_id");

-- CreateIndex
CREATE INDEX "metafield_definitions_owner_type_idx" ON "metafield_definitions"("owner_type");

-- CreateIndex
CREATE INDEX "metafield_definitions_namespace_key_idx" ON "metafield_definitions"("namespace", "key");

-- CreateIndex
CREATE UNIQUE INDEX "metafield_definitions_namespace_key_category_id_key" ON "metafield_definitions"("namespace", "key", "category_id");

-- CreateIndex
CREATE INDEX "product_metafields_product_id_idx" ON "product_metafields"("product_id");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_idx" ON "product_metafields"("metafield_definition_id");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_value_text_idx" ON "product_metafields"("metafield_definition_id", "value_text");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_value_numeric_idx" ON "product_metafields"("metafield_definition_id", "value_numeric");

-- CreateIndex
CREATE INDEX "product_metafields_metafield_definition_id_value_boolean_idx" ON "product_metafields"("metafield_definition_id", "value_boolean");

-- CreateIndex
CREATE UNIQUE INDEX "product_metafields_product_id_metafield_definition_id_key" ON "product_metafields"("product_id", "metafield_definition_id");

-- CreateIndex
CREATE INDEX "storefront_filters_metafield_definition_id_idx" ON "storefront_filters"("metafield_definition_id");

-- CreateIndex
CREATE INDEX "storefront_filters_scope_type_scope_id_idx" ON "storefront_filters"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "storefront_filters_is_active_sort_order_idx" ON "storefront_filters"("is_active", "sort_order");

-- AddForeignKey
ALTER TABLE "metafield_definitions" ADD CONSTRAINT "metafield_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_metafields" ADD CONSTRAINT "product_metafields_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_metafields" ADD CONSTRAINT "product_metafields_metafield_definition_id_fkey" FOREIGN KEY ("metafield_definition_id") REFERENCES "metafield_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_filters" ADD CONSTRAINT "storefront_filters_metafield_definition_id_fkey" FOREIGN KEY ("metafield_definition_id") REFERENCES "metafield_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "settlement_cycles_period_idx" RENAME TO "settlement_cycles_period_start_period_end_idx";
