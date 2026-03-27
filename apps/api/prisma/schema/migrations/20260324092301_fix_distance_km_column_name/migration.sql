/*
  Warnings:

  - You are about to drop the column `distanceKm` on the `allocation_logs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "allocation_logs" DROP COLUMN "distanceKm",
ADD COLUMN     "distance_km" DECIMAL(10,2);
