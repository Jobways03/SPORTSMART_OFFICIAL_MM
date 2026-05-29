-- Phase 28 (2026-05-21) — DPDP §6 consent versioning.
--
-- ConsentRecord now stamps which privacy-notice version the user
-- agreed to at the moment of grant/revoke. Pre-existing rows carry a
-- null version; new writes always populate it from
-- ConsentService.CURRENT_POLICY_VERSION. The new (purpose, granted)
-- index supports the marketing-eligibility batch queries the
-- notification gate now issues before dispatch.

ALTER TABLE "consent_records"
  ADD COLUMN "consent_version" TEXT;

CREATE INDEX "consent_records_purpose_granted_idx"
  ON "consent_records" ("purpose", "granted");
