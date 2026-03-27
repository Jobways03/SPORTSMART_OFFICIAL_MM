-- CreateTable
CREATE TABLE "post_offices" (
    "id" TEXT NOT NULL,
    "circle_name" TEXT NOT NULL,
    "region_name" TEXT NOT NULL,
    "division_name" TEXT NOT NULL,
    "office_name" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "office_type" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_offices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_offices_pincode_idx" ON "post_offices"("pincode");
CREATE INDEX "post_offices_district_idx" ON "post_offices"("district");
CREATE INDEX "post_offices_state_idx" ON "post_offices"("state");
