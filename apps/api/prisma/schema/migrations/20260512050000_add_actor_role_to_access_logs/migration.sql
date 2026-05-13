-- AlterTable
ALTER TABLE "access_logs" ADD COLUMN "actor_role" TEXT;

-- CreateIndex
CREATE INDEX "access_logs_actor_type_actor_role_created_at_idx" ON "access_logs"("actor_type", "actor_role", "created_at");
