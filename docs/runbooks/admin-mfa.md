# Runbook — Admin MFA + Step-up Auth

Owner: platform-security team. Phase 10 (PRs 10.1–10.10).

## What it is

Two-layer protection for admin accounts:

1. **Login-time MFA** — admins with `mfa_enabled_at != NULL` cannot finish a password-login alone. The password endpoint returns a short-lived JWT challenge (`aud=admin-mfa-challenge`) which the admin redeems at `/admin/mfa/verify-challenge` with a fresh 6-digit TOTP code or one of their backup codes. Only after that exchange do they receive a real session.

2. **Step-up auth on destructive ops** — routes annotated with `@RequiresStepUp({ maxAgeMs })` require the admin to have re-verified their TOTP within the configured window (default 5min). Verification stamps `admin_sessions.step_up_verified_at`; the `StepUpGuard` reads that column and returns `403 { code: 'STEP_UP_REQUIRED' }` when stale.

The TOTP secret is held in `admins.mfa_secret_ciphertext` as AES-256-GCM ciphertext keyed by `ADMIN_MFA_ENCRYPTION_KEY`. Backup codes are stored bcrypt-hashed (rounds=12) in `admins.mfa_backup_codes_hashes`. A monotonic step counter (`admins.mfa_last_used_step`) blocks TOTP replay within the ±30s validation window.

## Deploy checklist (Phase 10)

```bash
# 1. Generate a 32-byte encryption key (256 bits). DO NOT reuse an
#    existing app secret — this key only decrypts MFA secrets, and
#    rotating it is much safer when it's not shared.
openssl rand -base64 32
# -> store the output as ADMIN_MFA_ENCRYPTION_KEY in the prod secret
#    manager. Never commit the cleartext.

# 2. Apply the schema migrations. These add admins.mfa_* columns,
#    admin_sessions.step_up_verified_at, and an index on
#    admin.mfa_enabled_at.
pnpm --filter @sportsmart/api prisma:deploy

# 3. Regenerate the Prisma client so the new columns are typed.
pnpm --filter @sportsmart/api prisma:generate

# 4. Deploy the API. Env validator refuses prod boot if
#    ADMIN_MFA_ENCRYPTION_KEY is missing.

# 5. Walk each admin through enrollment:
#    POST /admin/mfa/enroll/begin  → returns otpauth:// URI
#    (admin scans into their authenticator app)
#    POST /admin/mfa/enroll/complete { code }  → returns 10 backup codes
#    The admin MUST save the backup codes before they leave the page —
#    they are never shown again.

# 6. (Optional, recommended) Apply @RequiresStepUp() to destructive
#    routes incrementally. Suggested initial set:
#    - admin deletion
#    - high-value refund approval
#    - encryption key rotation triggers
#    - MFA disable for another admin
#    Default window 5min is appropriate for most ops; tighten to 60s
#    for the most sensitive (key rotation, credential reset).
```

## Symptoms & responses

### Admin lost their TOTP device, has a backup code

Walk them through `/admin/mfa/verify-challenge` with the backup code (format `XXXXX-XXXXX`). On success they get a session and the consumed code is spliced out of `mfa_backup_codes_hashes` — they now have 9 left.

After login, recommend they immediately:
1. Enroll a new device. **Currently requires admin to first disable existing MFA** (`UPDATE admins SET mfa_enabled_at=NULL, mfa_secret_ciphertext=NULL, mfa_pending_secret_ciphertext=NULL WHERE id='…'`) — a self-service rotation endpoint is on the Phase-11 backlog.
2. Regenerate backup codes after re-enrollment.

### Admin lost their TOTP device AND lost all backup codes (panic-mode recovery)

This is the operator-intervention path. Verify the admin's identity out-of-band (video call + government ID is the established standard at SportsMart). Then:

```sql
-- Audit the panic-mode reset BEFORE doing it
INSERT INTO admin_action_audit_logs
  (admin_id, action_type, reason, metadata, created_at)
VALUES
  ('<recovering-admin-id>',
   'MFA_PANIC_RESET',
   'Lost device + lost backup codes; identity verified out-of-band by <operator>',
   '{"verifying_operator": "<your-name>", "verification_method": "video+id"}'::jsonb,
   now());

-- Clear MFA. Admin will be required to re-enroll on next login.
UPDATE admins
   SET mfa_enabled_at                = NULL,
       mfa_secret_ciphertext         = NULL,
       mfa_pending_secret_ciphertext = NULL,
       mfa_backup_codes_hashes       = NULL,
       mfa_last_used_step            = NULL
 WHERE id = '<recovering-admin-id>';

-- Revoke active sessions so the next login forces re-enrollment.
UPDATE admin_sessions
   SET revoked_at = now()
 WHERE admin_id = '<recovering-admin-id>' AND revoked_at IS NULL;
```

The audit row is non-negotiable. Panic resets are the prime target for social engineering — every one of them must be traceable to a named operator who verified the admin's identity.

### `403 { code: 'STEP_UP_REQUIRED' }` on a destructive route

The session's `step_up_verified_at` is null or older than the route's `maxAgeMs` window. Resolution: admin posts a fresh TOTP code (or a backup code) to `/admin/mfa/step-up`, which stamps the session and lets them retry the original request. The frontend should detect the `STEP_UP_REQUIRED` code and surface a TOTP modal automatically.

If a route's window is so tight that admins are stepping-up multiple times per session for routine work, the route's `@RequiresStepUp({ maxAgeMs })` is too aggressive. Either widen the window per-route or move that route off the destructive-ops list.

### Admin says "my TOTP code is rejected as already-used"

The anti-replay counter (`mfa_last_used_step`) is rejecting a TOTP that arrived for the same 30-second window as the previous successful verify. Two causes:

1. **Legitimate same-step retry** — admin double-tapped the submit button or refreshed mid-request. Have them wait for the next 30-second window and try again.
2. **Clock skew** — the admin's authenticator clock is off by more than 30s. iOS/Android automatic time settings normally prevent this; manual time is the usual culprit. Have them enable automatic time on their device.

```sql
-- Diagnostic: see the admin's last accepted step. Compare to
-- floor(extract(epoch from now()) / 30) — if the gap is >2, clock skew
-- is likely.
SELECT id, email, mfa_last_used_step,
       floor(extract(epoch from now()) / 30) AS current_step
  FROM admins WHERE email = '<admin-email>';
```

### Boot fails: "`ADMIN_MFA_ENCRYPTION_KEY` is required when NODE_ENV=production"

The env validator refuses to boot. Generate a key with `openssl rand -base64 32` and load it via the prod secret manager. **DO NOT** invent a placeholder — every admin who has enrolled has their TOTP secret encrypted under whatever key existed at that time. Booting with a different key makes every existing MFA enrollment undecryptable.

If you genuinely don't know the key (e.g. it was lost), every enrolled admin is in the panic-mode recovery path. Document the loss, audit-log the event, and walk each admin through the SQL above before they next try to log in. Then issue a new key and have every admin re-enroll.

### Encryption key rotation

Re-keying `ADMIN_MFA_ENCRYPTION_KEY` requires decrypting every `mfa_secret_ciphertext` with the old key and re-encrypting with the new one — there is no dual-key code path today (Phase-11 backlog item). The procedure:

1. Generate the new key. Hold both old and new in the secret manager temporarily, but only `ADMIN_MFA_ENCRYPTION_KEY` is read by the running API.

2. Drain admin traffic (this is a maintenance window; the system can't decrypt mid-flight while the column is being rewritten in bulk).

3. Run a one-shot script that streams the `admins` table, decrypts each `mfa_secret_ciphertext` with the OLD key, re-encrypts with the NEW key, and writes back. Same for `mfa_pending_secret_ciphertext`.

4. Atomically swap `ADMIN_MFA_ENCRYPTION_KEY` to the new value in the secret manager. Restart the API.

5. Smoke-test by logging in as a known-enrolled admin (e.g. the on-call's own account). If login succeeds, rotation succeeded.

6. After 24h of normal operation with no decrypt errors, retire the old key.

If the rotation script fails partway through (some rows re-encrypted, some not), do NOT swap the live key — restore from backup and retry. A partial rotation leaves the system unable to decrypt half the admins' secrets, regardless of which key is active.

Backup-code hashes are bcrypt and don't depend on the encryption key — they're untouched by rotation.

## Operating envelope

| Knob | Default | Recommended |
|---|---|---|
| `ADMIN_MFA_ENCRYPTION_KEY` | (required in prod) | 32 bytes from `openssl rand -base64 32`; rotated annually OR on suspected compromise |
| TOTP window skew | ±1 step (±30s) | hard-coded; widening weakens replay resistance |
| `mfa_last_used_step` enforcement | always on | always on; the column is the only anti-replay guard |
| Backup codes per admin | 10 (XXXXX-XXXXX) | 10; re-issue when remaining drops below 3 |
| bcrypt rounds for backup codes | 12 | 12; matches admin password hashing cost |
| `@RequiresStepUp({ maxAgeMs })` default | 300_000 (5min) | 300_000 for routine destructive ops; 60_000 for the most sensitive (key rotation, credential reset, admin deletion) |
| Step-up endpoint path | `/admin/mfa/step-up` | unchanged; frontend dispatches on `code: 'STEP_UP_REQUIRED'` |
| Enrollment paths | `/admin/mfa/enroll/begin` → `/admin/mfa/enroll/complete` | unchanged |
| Login MFA challenge audience | `aud=admin-mfa-challenge` | unchanged; session tokens have `aud=admin-session` and cannot be substituted |

## Rollback

There is no global "disable MFA" flag, by design — once an admin has enrolled, removing their second factor without explicit operator action would defeat the system's purpose. The supported rollback paths are:

1. **Stop requiring MFA for new admins** — remove the enrollment prompt from the admin onboarding flow. Existing enrolled admins remain protected.

2. **Disable step-up enforcement on a specific route** — remove the `@RequiresStepUp()` decorator. The `StepUpGuard` becomes a no-op for that route (it pass-through when metadata is absent).

3. **Disable MFA for an individual admin** — the panic-mode SQL above (clear all `mfa_*` columns). Audit-log the action.

4. **Full feature removal (extreme)** — remove `StepUpGuard` from the global guards module, remove all `@RequiresStepUp` decorators, leave the columns in place (additive schema). Login challenge can be disabled by short-circuiting `AdminLoginUseCase` to skip the `mfa_enabled_at` check. Schema rollback (`mfa_*` column drops) only after a full retention window where no enrolled admin returns.

The encryption-key requirement at boot does NOT have a rollback path. Removing the key check would let the API start without the ability to decrypt enrolled admins' secrets — every login would then fail in a confusing way. If the key is genuinely lost, see panic-mode recovery above for every enrolled admin.

## Test in pre-prod

```bash
# 1. Confirm the API booted with ADMIN_MFA_ENCRYPTION_KEY set.
curl localhost:8000/api/v1/health/live

# 2. Enroll a test admin (assumes you already have a session via
#    password-login on an admin whose mfa_enabled_at IS NULL).
ENROLL=$(curl -X POST $API/admin/mfa/enroll/begin \
   -H "Authorization: Bearer $TOKEN")
echo $ENROLL
# Expect: { otpAuthUrl: "otpauth://totp/SportsMart:<email>?...", secret: "..." }
# Scan the URI into Google Authenticator (or run an otpauth CLI).

# 3. Submit the current 6-digit code to complete enrollment.
curl -X POST $API/admin/mfa/enroll/complete \
   -H "Authorization: Bearer $TOKEN" \
   -H "Content-Type: application/json" \
   --data '{"code":"123456"}'
# Expect: { backupCodes: ["XXXXX-XXXXX", ... 10 total ... ],
#           message: "Save these now — they will never be shown again" }
# Verify in DB:
#   psql -c "SELECT mfa_enabled_at, length(mfa_secret_ciphertext) FROM admins WHERE id='<id>';"
#   mfa_enabled_at NOT NULL, mfa_secret_ciphertext non-empty.

# 4. Log out, log back in (password endpoint).
LOGIN=$(curl -X POST $API/admin/auth/login \
   -H "Content-Type: application/json" \
   --data '{"email":"<email>","password":"<pwd>"}')
# Expect: { mfaChallenge: "<jwt>" } — NOT a session token.

# 5. Redeem with TOTP.
curl -X POST $API/admin/mfa/verify-challenge \
   -H "Content-Type: application/json" \
   --data "{\"challenge\":\"<jwt>\",\"code\":\"<current-totp>\"}"
# Expect: { accessToken, refreshToken } — real session.

# 6. Step-up: hit a @RequiresStepUp route — expect 403.
curl -X POST $API/admin/sensitive-op \
   -H "Authorization: Bearer $TOKEN"
# Expect: 403 { code: "STEP_UP_REQUIRED" }
# Then:
curl -X POST $API/admin/mfa/step-up \
   -H "Authorization: Bearer $TOKEN" \
   --data "{\"code\":\"<current-totp>\"}"
# Expect: 204. Retry the original request → 200/2xx.

# 7. Anti-replay: post the SAME TOTP again to /admin/mfa/step-up.
# Expect: 400 "This TOTP code has already been used."

# 8. Backup code: post one of the codes from step 3 to /admin/mfa/step-up.
curl -X POST $API/admin/mfa/step-up \
   --data "{\"code\":\"XXXXX-XXXXX\"}"
# Expect: 204. Verify in DB that the code count dropped by 1:
#   psql -c "SELECT jsonb_array_length(mfa_backup_codes_hashes) FROM admins WHERE id='<id>';"

# 9. Encryption-key rotation smoke (use a STAGING-only key swap; do
#    not exercise this in prod without the maintenance-window procedure):
#    - capture the current mfa_secret_ciphertext for the test admin
#    - rotate the key per the procedure above
#    - log the test admin in again — login must succeed, proving
#      decrypt-with-new-key works.
```

A successful end-to-end run of steps 1–8 in staging is the gate for promoting MFA to prod.
