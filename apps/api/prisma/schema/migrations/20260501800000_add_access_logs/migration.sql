-- CreateEnum
CREATE TYPE "AccessActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE');

-- CreateEnum
CREATE TYPE "AccessEventKind" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'TOKEN_REFRESH', 'PASSWORD_RESET', 'NEW_DEVICE_DETECTED');

-- CreateTable
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL,
    "actor_type" "AccessActorType" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "kind" "AccessEventKind" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_hash" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_logs_actor_type_actor_id_idx" ON "access_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "access_logs_kind_idx" ON "access_logs"("kind");

-- CreateIndex
CREATE INDEX "access_logs_created_at_idx" ON "access_logs"("created_at");
