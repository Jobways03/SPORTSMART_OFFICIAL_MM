-- CreateTable: pincode_database
CREATE TABLE "pincode_database" (
    "id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "zone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pincode_database_pkey" PRIMARY KEY ("id")
);

-- CreateTable: seller_service_areas
CREATE TABLE "seller_service_areas" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: pincode_database
CREATE UNIQUE INDEX "pincode_database_pincode_key" ON "pincode_database"("pincode");
CREATE INDEX "pincode_database_city_idx" ON "pincode_database"("city");
CREATE INDEX "pincode_database_state_idx" ON "pincode_database"("state");
CREATE INDEX "pincode_database_zone_idx" ON "pincode_database"("zone");

-- CreateIndex: seller_service_areas
CREATE UNIQUE INDEX "seller_service_areas_seller_id_pincode_key" ON "seller_service_areas"("seller_id", "pincode");
CREATE INDEX "seller_service_areas_seller_id_idx" ON "seller_service_areas"("seller_id");
CREATE INDEX "seller_service_areas_pincode_idx" ON "seller_service_areas"("pincode");

-- AddForeignKey
ALTER TABLE "seller_service_areas" ADD CONSTRAINT "seller_service_areas_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: Sample pincodes for Hyderabad/Secunderabad area
INSERT INTO "pincode_database" ("id", "pincode", "city", "state", "country", "latitude", "longitude", "zone", "is_active", "created_at", "updated_at") VALUES
  (gen_random_uuid(), '500001', 'Hyderabad', 'Telangana', 'IN', 17.3850000, 78.4867000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500003', 'Hyderabad', 'Telangana', 'IN', 17.3843000, 78.4955000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500018', 'Secunderabad', 'Telangana', 'IN', 17.4399000, 78.4983000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500034', 'Hyderabad', 'Telangana', 'IN', 17.4325000, 78.4073000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500081', 'Hyderabad', 'Telangana', 'IN', 17.4947000, 78.3996000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500084', 'Hyderabad', 'Telangana', 'IN', 17.4969000, 78.3548000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500032', 'Hyderabad', 'Telangana', 'IN', 17.4156000, 78.4347000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '500072', 'Hyderabad', 'Telangana', 'IN', 17.3457000, 78.5522000, 'SOUTH', true, NOW(), NOW());

-- Seed: Sample pincodes for Bangalore area
INSERT INTO "pincode_database" ("id", "pincode", "city", "state", "country", "latitude", "longitude", "zone", "is_active", "created_at", "updated_at") VALUES
  (gen_random_uuid(), '560001', 'Bangalore', 'Karnataka', 'IN', 12.9716000, 77.5946000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '560002', 'Bangalore', 'Karnataka', 'IN', 12.9634000, 77.5855000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '560034', 'Bangalore', 'Karnataka', 'IN', 12.9698000, 77.7500000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '560037', 'Bangalore', 'Karnataka', 'IN', 12.8456000, 77.6603000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '560066', 'Bangalore', 'Karnataka', 'IN', 12.9116000, 77.6474000, 'SOUTH', true, NOW(), NOW()),
  (gen_random_uuid(), '560103', 'Bangalore', 'Karnataka', 'IN', 12.8600000, 77.7870000, 'SOUTH', true, NOW(), NOW());
