-- Sign in with Google (storefront customers): external identity links +
-- passwordless customers. Forward-only.

-- OAuth-only customers have no password.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- External identity-provider links (one row per provider per user).
CREATE TABLE "auth_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email" TEXT,
    "email_verified_by_provider" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
