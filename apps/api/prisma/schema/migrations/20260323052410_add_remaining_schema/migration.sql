-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED', 'PERCENTAGE_PLUS_FIXED', 'FIXED_PLUS_PERCENTAGE');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT_OFF_PRODUCTS', 'BUY_X_GET_Y', 'AMOUNT_OFF_ORDER', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "DiscountMethod" AS ENUM ('CODE', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "DiscountValueType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "DiscountAppliesTo" AS ENUM ('ALL_PRODUCTS', 'SPECIFIC_COLLECTIONS', 'SPECIFIC_PRODUCTS');

-- CreateEnum
CREATE TYPE "DiscountMinRequirement" AS ENUM ('NONE', 'MIN_PURCHASE_AMOUNT', 'MIN_QUANTITY');

-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('ACTIVE', 'SCHEDULED', 'EXPIRED', 'DRAFT');

-- CreateEnum
CREATE TYPE "BxgyGetDiscountType" AS ENUM ('PERCENTAGE', 'AMOUNT_OFF', 'FREE');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'PAID', 'VOIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderFulfillmentStatus" AS ENUM ('UNFULFILLED', 'FULFILLED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "OrderAcceptStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('COD');

-- AlterTable
ALTER TABLE "sellers" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "parent_id" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_values" (
    "id" TEXT NOT NULL,
    "option_definition_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "display_value" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_option_templates" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "option_definition_id" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_option_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "category_id" TEXT,
    "brand_id" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "moderation_note" TEXT,
    "has_variants" BOOLEAN NOT NULL DEFAULT false,
    "base_price" DECIMAL(10,2),
    "compare_at_price" DECIMAL(10,2),
    "cost_price" DECIMAL(10,2),
    "base_sku" TEXT,
    "base_stock" INTEGER,
    "base_barcode" TEXT,
    "weight" DECIMAL(10,3),
    "weight_unit" TEXT DEFAULT 'kg',
    "length" DECIMAL(10,2),
    "width" DECIMAL(10,2),
    "height" DECIMAL(10,2),
    "dimension_unit" TEXT DEFAULT 'cm',
    "return_policy" TEXT,
    "warranty_info" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "option_definition_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "option_value_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "compare_at_price" DECIMAL(10,2),
    "cost_price" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "weight" DECIMAL(10,3),
    "weight_unit" TEXT DEFAULT 'kg',
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_option_values" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "option_value_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_images" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variant_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_seo" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "handle" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_seo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collection_maps" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_collection_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_status_history" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "commission_type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commission_value" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "second_commission_value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fixed_commission_type" TEXT NOT NULL DEFAULT 'Product',
    "enable_max_commission" BOOLEAN NOT NULL DEFAULT false,
    "max_commission_amount" DECIMAL(10,2),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_records" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "commission_type" "CommissionType" NOT NULL,
    "commission_rate" TEXT NOT NULL,
    "unit_commission" DECIMAL(10,2) NOT NULL,
    "total_commission" DECIMAL(10,2) NOT NULL,
    "admin_earning" DECIMAL(10,2) NOT NULL,
    "product_earning" DECIMAL(10,2) NOT NULL,
    "refunded_admin_earning" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "vat_on_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shipping_commission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT,
    "type" "DiscountType" NOT NULL,
    "method" "DiscountMethod" NOT NULL DEFAULT 'CODE',
    "value_type" "DiscountValueType" NOT NULL DEFAULT 'PERCENTAGE',
    "value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "applies_to" "DiscountAppliesTo" NOT NULL DEFAULT 'ALL_PRODUCTS',
    "eligibility" TEXT NOT NULL DEFAULT 'ALL_CUSTOMERS',
    "min_requirement" "DiscountMinRequirement" NOT NULL DEFAULT 'NONE',
    "min_requirement_value" DECIMAL(10,2),
    "max_uses" INTEGER,
    "one_per_customer" BOOLEAN NOT NULL DEFAULT false,
    "combine_product" BOOLEAN NOT NULL DEFAULT false,
    "combine_order" BOOLEAN NOT NULL DEFAULT false,
    "combine_shipping" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "status" "DiscountStatus" NOT NULL DEFAULT 'ACTIVE',
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "buy_type" TEXT,
    "buy_value" DECIMAL(10,2),
    "buy_items_from" TEXT,
    "get_quantity" INTEGER,
    "get_items_from" TEXT,
    "get_discount_type" "BxgyGetDiscountType",
    "get_discount_value" DECIMAL(10,2),
    "max_uses_per_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_products" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'APPLIES',

    CONSTRAINT "discount_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_collections" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'APPLIES',

    CONSTRAINT "discount_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "shipping_address_snapshot" JSONB NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "OrderPaymentMethod" NOT NULL DEFAULT 'COD',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "item_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_orders" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "sub_total" DECIMAL(10,2) NOT NULL,
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillment_status" "OrderFulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "accept_status" "OrderAcceptStatus" NOT NULL DEFAULT 'OPEN',
    "delivered_at" TIMESTAMP(3),
    "return_window_ends_at" TIMESTAMP(3),
    "commission_processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "sku" TEXT,
    "image_url" TEXT,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_slug_idx" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "option_definitions_name_key" ON "option_definitions"("name");

-- CreateIndex
CREATE INDEX "option_values_option_definition_id_idx" ON "option_values"("option_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_values_option_definition_id_value_key" ON "option_values"("option_definition_id", "value");

-- CreateIndex
CREATE INDEX "category_option_templates_category_id_idx" ON "category_option_templates"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_option_templates_category_id_option_definition_id_key" ON "category_option_templates"("category_id", "option_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_seller_id_idx" ON "products"("seller_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_moderationStatus_idx" ON "products"("moderationStatus");

-- CreateIndex
CREATE INDEX "products_slug_idx" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_is_deleted_idx" ON "products"("is_deleted");

-- CreateIndex
CREATE INDEX "product_options_product_id_idx" ON "product_options"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_option_definition_id_key" ON "product_options"("product_id", "option_definition_id");

-- CreateIndex
CREATE INDEX "product_option_values_product_id_idx" ON "product_option_values"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_product_id_option_value_id_key" ON "product_option_values"("product_id", "option_value_id");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_sku_idx" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE INDEX "product_variants_is_deleted_idx" ON "product_variants"("is_deleted");

-- CreateIndex
CREATE INDEX "product_variant_option_values_variant_id_idx" ON "product_variant_option_values"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_option_values_variant_id_option_value_id_key" ON "product_variant_option_values"("variant_id", "option_value_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_idx" ON "product_images"("product_id");

-- CreateIndex
CREATE INDEX "product_variant_images_variant_id_idx" ON "product_variant_images"("variant_id");

-- CreateIndex
CREATE INDEX "product_tags_product_id_idx" ON "product_tags"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tags_product_id_tag_key" ON "product_tags"("product_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "product_seo_product_id_key" ON "product_seo"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_collections_name_key" ON "product_collections"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_collections_slug_key" ON "product_collections"("slug");

-- CreateIndex
CREATE INDEX "product_collections_slug_idx" ON "product_collections"("slug");

-- CreateIndex
CREATE INDEX "product_collection_maps_product_id_idx" ON "product_collection_maps"("product_id");

-- CreateIndex
CREATE INDEX "product_collection_maps_collection_id_idx" ON "product_collection_maps"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_collection_maps_product_id_collection_id_key" ON "product_collection_maps"("product_id", "collection_id");

-- CreateIndex
CREATE INDEX "product_status_history_product_id_idx" ON "product_status_history"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_records_order_item_id_key" ON "commission_records"("order_item_id");

-- CreateIndex
CREATE INDEX "commission_records_seller_id_idx" ON "commission_records"("seller_id");

-- CreateIndex
CREATE INDEX "commission_records_master_order_id_idx" ON "commission_records"("master_order_id");

-- CreateIndex
CREATE INDEX "commission_records_sub_order_id_idx" ON "commission_records"("sub_order_id");

-- CreateIndex
CREATE INDEX "commission_records_order_item_id_idx" ON "commission_records"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_code_key" ON "discounts"("code");

-- CreateIndex
CREATE INDEX "discounts_code_idx" ON "discounts"("code");

-- CreateIndex
CREATE INDEX "discounts_status_idx" ON "discounts"("status");

-- CreateIndex
CREATE INDEX "discount_products_discount_id_idx" ON "discount_products"("discount_id");

-- CreateIndex
CREATE INDEX "discount_products_product_id_idx" ON "discount_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_products_discount_id_product_id_scope_key" ON "discount_products"("discount_id", "product_id", "scope");

-- CreateIndex
CREATE INDEX "discount_collections_discount_id_idx" ON "discount_collections"("discount_id");

-- CreateIndex
CREATE INDEX "discount_collections_collection_id_idx" ON "discount_collections"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_collections_discount_id_collection_id_scope_key" ON "discount_collections"("discount_id", "collection_id", "scope");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_customer_id_key" ON "carts"("customer_id");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items"("cart_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_product_id_variant_id_key" ON "cart_items"("cart_id", "product_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_orders_order_number_key" ON "master_orders"("order_number");

-- CreateIndex
CREATE INDEX "master_orders_customer_id_idx" ON "master_orders"("customer_id");

-- CreateIndex
CREATE INDEX "master_orders_order_number_idx" ON "master_orders"("order_number");

-- CreateIndex
CREATE INDEX "sub_orders_master_order_id_idx" ON "sub_orders"("master_order_id");

-- CreateIndex
CREATE INDEX "sub_orders_seller_id_idx" ON "sub_orders"("seller_id");

-- CreateIndex
CREATE INDEX "order_items_sub_order_id_idx" ON "order_items"("sub_order_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_option_definition_id_fkey" FOREIGN KEY ("option_definition_id") REFERENCES "option_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_option_templates" ADD CONSTRAINT "category_option_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_option_templates" ADD CONSTRAINT "category_option_templates_option_definition_id_fkey" FOREIGN KEY ("option_definition_id") REFERENCES "option_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_option_definition_id_fkey" FOREIGN KEY ("option_definition_id") REFERENCES "option_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_images" ADD CONSTRAINT "product_variant_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_seo" ADD CONSTRAINT "product_seo_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collection_maps" ADD CONSTRAINT "product_collection_maps_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collection_maps" ADD CONSTRAINT "product_collection_maps_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_status_history" ADD CONSTRAINT "product_status_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_collections" ADD CONSTRAINT "discount_collections_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_collections" ADD CONSTRAINT "discount_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
