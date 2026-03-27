-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "dimension_unit" TEXT DEFAULT 'cm',
ADD COLUMN     "height" DECIMAL(10,2),
ADD COLUMN     "length" DECIMAL(10,2),
ADD COLUMN     "width" DECIMAL(10,2);
