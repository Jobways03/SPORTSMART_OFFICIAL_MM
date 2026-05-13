# Runbook — Production Boot Failures

Owner: platform-security team. Sources: `src/bootstrap/env/env.schema.ts`, Phases 2 / 3 / 6 / 7 / 10.

## What it is

Every prod boot of the API runs the Zod env-validator (`env.schema.ts`). If any required-in-production secret is missing, any required-in-production flag is off, or any cross-field interlock is violated, the API refuses to start and logs the offending `ZodIssue` chain. This is intentional: silent prod misconfiguration has historically been worse than loud refusal to boot.

This runbook is keyed by the literal error strings the validator emits, so an on-call engineer can paste their boot error and find the response section. Four categories:

1. **Prod-required secrets** — error pattern: `<KEY> is required when NODE_ENV=production`
2. **Prod-required flags** — error pattern: `<KEY> must be 'true' when NODE_ENV=production. <reason>`
3. **Cross-field interlocks** — outbox + JWT shape + JWT-collision; some run on every env, some prod-only
4. **Prod-only hardening** — CORS allow-list policy + JWT TTL ceiling

If a boot failure doesn't match any pattern below, the validator wasn't the source — check the stack trace for module-level failures (Prisma connect, Redis dial, S3 client init).

## Category 1 — `<KEY> is required when NODE_ENV=production`

The named env var is empty / undefined / whitespace-only and is on the `requiredInProd` allow-list. Eight keys are on that list today:

| Key | Owner | What it gates |
|---|---|---|
| `RAZORPAY_KEY_ID` | payments | Razorpay client init — without it every checkout 500s on order creation |
| `RAZORPAY_KEY_SECRET` | payments | HMAC verification on payment-success callback; missing key → constant-time comparison against an empty digest → everything looks tampered |
| `RAZORPAY_WEBHOOK_SECRET` | payments | Webhook signature verify; missing → no webhook can be processed, refunds and order updates silently stall |
| `S3_BUCKET` | files | All file uploads (KYC docs, listing images, evidence) — endpoint 500s with cryptic AWS SDK error |
| `S3_REGION` | files | Same as above; SDK falls back to us-east-1 if absent, which usually doesn't have the bucket |
| `S3_ACCESS_KEY` | files | AWS auth — missing → every S3 op returns NoCredentialsError |
| `S3_SECRET_KEY` | files | AWS auth — same |
| `ADMIN_MFA_ENCRYPTION_KEY` | platform-security | Decrypts `admins.mfa_secret_ciphertext`; without it every enrolled admin's TOTP verify 500s. See `admin-mfa.md` for full procedure. |

**Response**: source the value from the prod secret manager and inject it into the deployment environment. If the value is genuinely lost:

- Razorpay keys — regenerate in the Razorpay dashboard; rotate webhook secret too.
- S3 credentials — issue a new IAM access key in AWS; update the bucket policy if needed.
- `ADMIN_MFA_ENCRYPTION_KEY` — losing this is the worst outcome (every enrolled admin's TOTP secret becomes undecryptable). Generate a new key, then walk every enrolled admin through the MFA panic-reset procedure documented in `admin-mfa.md`. Do not invent a placeholder key — that gets you past the boot check and into a non-recoverable state where the wrong key silently decrypts to garbage on the first MFA login attempt.

## Category 2 — `<KEY> must be 'true' when NODE_ENV=production. <reason>`

The named flag is not `true` and is on the `requiredOnInProd` policy list. Sixteen flags are on that list today (Phase 6's flag-flip campaign). Each emits a single-line reason; if the boot error shows `<reason>`, that text alone is usually enough to identify the consequence and the response. Quick lookup:

| Flag | Phase | What goes silent if off in prod |
|---|---|---|
| `CRON_HEARTBEAT_ENABLED` | 5 | Silent cron stoppages — every @Cron service is wired into the heartbeat detector and would not be missed |
| `SLA_BREACH_DETECTOR_ENABLED` | 6.2 | SLA escalation chain for returns/disputes/tickets |
| `AUDIT_CHAIN_ANCHOR_ENABLED` | 6.3 | Tamper-evidence Merkle anchors |
| `IDEMPOTENCY_ENABLED` | 6.4 | Retry-safety on money-mutating POSTs (duplicate captures / refunds / payouts) |
| `INTEGRITY_VERIFIER_ENABLED` | 6.5 | SHA-256 mismatch detection on stored files (KYC, evidence, invoices) |
| `ERASURE_PROCESSOR_ENABLED` | 6.6 | DPDPA/GDPR erasure-request queue — statutory windows missed |
| `WALLET_LEDGER_RECON_ENABLED` | 6.7 | Daily wallet-balance vs ledger-sum drift detection |
| `EVENT_DEDUP_ENABLED` | 6.8 | Effective exactly-once handler boundary on outbox replays |
| `OUTBOX_ENABLED` | 6.9 | Outbox publisher drains the table |
| `OUTBOX_DUAL_WRITE` | 6.10 | EventBus writes to outbox in the same transaction |
| `REFUND_GATEWAY_RECON_ENABLED` | 6.11 | Razorpay refund-webhook-drop safety net |
| `RETENTION_ENFORCER_ENABLED` | 6.12 | Statutory retention policies (DELETE/ARCHIVE/REDACT) |
| `ABAC_ENABLED` | 6.13 | Strict (fail-closed) ABAC policy evaluation |
| `REFUND_SAGA_ENABLED` | 6.14 | Refund-saga resumability across crashes |
| `COD_REFUND_PENDING_ENABLED` | 6.15 | Visibility of stuck COD manual-refund queue |
| `MONEY_DUAL_WRITE_ENABLED` | 7.1 | Paise-sibling columns populated on every Decimal money write — required base camp for the ADR-007 read-switch |

**Response**: turn on the flag. None of these flags should be off in prod under any rollout-soak rationale — every one of them has finished its soak. If a flag was explicitly turned off as part of an incident response, that incident must be tracked in PagerDuty / Linear before the system is re-deployed.

## Category 3 — Cross-field interlocks

### `OUTBOX_AUTHORITATIVE=true requires OUTBOX_ENABLED=true`

You flipped the authoritative-emitter flag without enabling the publisher. Nothing would drain `outbox_events`; every event silently sits forever once direct emit is disabled. See `transactional-outbox.md` for the correct flip order.

**Response**: set `OUTBOX_ENABLED=true` first; redeploy with both flags on. Or back the change out: `OUTBOX_AUTHORITATIVE=false`.

### `OUTBOX_AUTHORITATIVE=true requires OUTBOX_DUAL_WRITE=true`

Same shape, different leg: you flipped authoritative without telling writers to populate the outbox. Direct emit is disabled but no rows are being created, so every event is dropped.

**Response**: set `OUTBOX_DUAL_WRITE=true` first; redeploy. Or back out.

### `JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL`

Refresh tokens are useless if they expire first — you'd never get a chance to use them. Common cause: someone copy-pasted the access TTL into the refresh slot.

**Response**: pick standard values. Production policy is `JWT_ACCESS_TTL` ≤ 24h and `JWT_REFRESH_TTL` ≥ a week. Typical: `JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=14d`.

### `JWT_ACCESS_TTL must be a positive duration like '15m', '1h', '24h'` (or same for `JWT_REFRESH_TTL`)

The value isn't parseable as a duration string. Accepted suffixes: `s`, `m`, `h`, `d`. Bare numbers reject — must have a unit.

**Response**: fix the value.

### `JWT secret collision: A and B share the same value`

Two actor scopes (customer / seller / admin / franchise / affiliate) share the same JWT secret. Per-actor isolation is the design — sharing a secret means a customer token can decode against the admin verifier, and vice versa.

**Response**: generate a distinct 32+ char secret for each actor with `openssl rand -base64 48` and assign one to each `*_JWT_SECRET` env.

## Category 4 — Prod-only hardening

### `JWT_ACCESS_TTL must be <= 24h in production`

Production policy caps access-token lifetime at 24h. Longer-lived access tokens turn every cross-device logout into a 24h vulnerability window. Dev/staging stays flexible.

**Response**: lower to 24h or shorter. Use refresh-token rotation for longer sessions.

### `CORS_ORIGINS must be an explicit comma-separated allow-list in production (got empty)`

The `CORS_ORIGINS` env was empty in production. Empty means no browser request can hit the API.

**Response**: populate with the actual production frontend origins (comma-separated). Typical: `https://www.sportsmart.com,https://admin.sportsmart.com,...`.

### `CORS_ORIGINS wildcard '*' is rejected in production`

Combined with `credentials: true` in `main.ts`, a wildcard origin is a credential-exfiltration setup: any site the user visits can issue a `fetch` with cookies and read the response.

**Response**: replace `*` with the explicit allow-list.

### `CORS_ORIGINS entry '<x>' is not a valid URL`

A typo in the allow-list entry. The whole value is rejected (fail-closed); fix the offending entry.

**Response**: fix the typo. The error message includes the offending substring.

### `CORS_ORIGINS entry '<x>' must use https:// in production`

A production origin pointed at `http://`. Stripping the scheme to plaintext during a CDN bug would leak Bearer tokens.

**Response**: change to `https://`. If the staging URL is genuinely HTTP, it belongs in the staging env, not the prod env.

## Operating envelope

| Knob | Default | Production policy |
|---|---|---|
| `NODE_ENV` | `development` | must be `production` for prod boot |
| `JWT_ACCESS_TTL` | `15m` | ≤ 24h |
| `JWT_REFRESH_TTL` | `7d` | strictly > `JWT_ACCESS_TTL` |
| `CORS_ORIGINS` | (none) | explicit comma-separated `https://` allow-list, no `*` |
| All `*_JWT_SECRET` | (none) | each actor distinct; minimum 32 chars (recommended `openssl rand -base64 48`) |
| All `requiredInProd` secrets | (none) | non-empty; sourced from prod secret manager |
| All `requiredOnInProd` flags | `false` | `true` in prod |
| `OUTBOX_ENABLED` + `OUTBOX_DUAL_WRITE` + `OUTBOX_AUTHORITATIVE` | all false | all true in steady state; flip order: ENABLED → DUAL_WRITE → AUTHORITATIVE |
| `ADMIN_MFA_ENCRYPTION_KEY` | (none) | required; 32 bytes from `openssl rand -base64 32`; see `admin-mfa.md` for rotation |
| `MONEY_DUAL_WRITE_ENABLED` | `false` | `true` in prod (ADR-007 base camp) |

## Rollback

There is no rollback for the validator itself — it is the rollback. The validator's whole purpose is to refuse to let a misconfigured API serve traffic.

What you CAN do during incident response:

1. **Roll back the deploy** — if the boot failure came from a recent env change in CI, revert the env change in the secret manager and redeploy the previous build. The validator is not asking you to remove the check; it's asking you to fix the env.

2. **Temporarily downgrade to a previous image** — the previous image had a less-strict validator (e.g. before PR 10.8 added `ADMIN_MFA_ENCRYPTION_KEY` to `requiredInProd`). This buys time to source the missing value, at the cost of every protection that PR added. Document the rollback in an incident ticket and re-deploy the current image within the SLA window.

3. **Do NOT** patch `env.schema.ts` to remove a check and ship a hotfix. Every entry in `requiredInProd` / `requiredOnInProd` is there because a prior incident proved that the off-state silently corrupts something. Removing the check is the worst possible response to a boot failure.

The exceptions are validator bugs (e.g. a check that no longer matches a renamed env var). Those are real and warrant a fix-the-validator hotfix; the test is "is the validator wrong, or is the env wrong?"

## Test in pre-prod

```bash
# 1. Set NODE_ENV=production locally with an empty .env to surface
#    the full validator error chain in one go.
NODE_ENV=production pnpm --filter @sportsmart/api start 2>&1 | head -200
# Expect: the validator dumps a list of ZodIssue rows, one per
# violated check. Read them top to bottom.

# 2. To reproduce a SPECIFIC error, take a known-good staging .env and
#    perturb one value at a time:
#    - Comment out RAZORPAY_KEY_ID → "is required when NODE_ENV=production"
#    - Set OUTBOX_AUTHORITATIVE=true without DUAL_WRITE → interlock error
#    - Set JWT_ACCESS_TTL=2h, JWT_REFRESH_TTL=1h → ordering error
#    - Set CORS_ORIGINS=* → wildcard rejection
#    - Set CORS_ORIGINS=http://example.com → https requirement

# 3. To verify the validator is exercised on every boot:
pnpm jest test/unit/env-schema-prod-required-*.spec.ts \
          test/unit/env-schema-prod-flags-*.spec.ts \
          test/unit/env-schema-cors-prod.spec.ts \
          test/unit/env-schema-jwt-*.spec.ts \
          test/unit/env-schema-outbox-*.spec.ts
# All env-schema specs in test/unit/ exercise the validator with
# crafted fixtures; collectively they cover every check above.

# 4. To produce a baseline list of every error string the validator
#    currently emits:
grep -E "message:\s+(['\"\\\`])" src/bootstrap/env/env.schema.ts
# This is the authoritative inventory; if this runbook's error
# headings get out of sync with that output, update the runbook.
```

The promotion gate for a prod deploy is: the validator boots cleanly on the prod env file. A clean local boot with the prod-shaped env (NODE_ENV=production, full secret set) is the strongest pre-flight signal.
