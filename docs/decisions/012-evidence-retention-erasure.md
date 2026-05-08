# ADR-012: Evidence integrity, retention, and data erasure

**Status**: Accepted

**Date**: 2026-05-06

**Phase**: 7 (PRs 7.1–7.5) of the 10-phase Returns + Disputes redesign

## Context

Phase 0 audit on the file pipeline:

* No content hash. Once the bytes left our process to S3 / Cloudinary,
  we had no way to detect tampering — a swapped image would render
  the same UI and there's nothing in the metadata that says "this is
  the original".
* No retention policy. Every file accumulates forever. Customer
  uploaded a KYC doc in 2022? Still on disk. Once GDPR / Indian DPDP
  Act enforcement kicks in, the merchant of record (us) carries the
  legal liability for retaining personal data past necessity.
* Signed URLs all expire in 5 minutes (good) but no audit trail of
  who pulled them. "Show me every admin who pulled this seller's
  cancelled-cheque image last week" → not answerable.
* No "right to be forgotten" mechanism. A user asking us to delete
  their data has to file a support ticket and an engineer runs an
  ad-hoc SQL update. Not auditable, not consistent across actor types.

Phase 7 closes all four with infrastructure layered alongside the
existing files module rather than inside it (so future actor-types
and resource-types can reuse the same plumbing).

## Decision

Five PRs:

| PR | Lands |
|---|---|
| **7.1** | `contentSha256` + `hashAlgorithm` + `hashedAt` + `lastVerifiedAt` columns on `file_metadata`; SHA-256 hash on direct upload; deferred hash for the S3 confirm path (verifier backfills). |
| **7.2** | `retention_policies` + `retention_executions` tables; `RetentionEnforcerCron` daily; `LegalHoldService` blocks on open dispute / open settlement / active return. DRY-RUN mode for soak. |
| **7.3** | `file_url_audits` table; `FileUrlAuditService` with per-purpose TTL caps (KYC=60s, INVOICE=120s, default=600s) and per-(file, requester) rate limit (30 / 10min). New `TooManyRequestsAppException` → 429. |
| **7.4** | `data_erasure_requests` table; `ErasureService` with 24h cooldown for USER_REQUEST source; `ErasureProcessorCron` hourly. v1 handles USER subjects only — seller / affiliate / franchise are stubbed. |
| **7.5** | `IntegrityVerifierCron` (hourly, batched), this ADR, runbook (`phase-7-evidence-retention-erasure.md`). |

### Hash on upload, deferred for confirm

The direct-upload path has the buffer in memory — hashing inline costs
~10ms/MB and we already pay the upload latency, so the marginal cost
is invisible. The S3 pre-signed-URL flow doesn't have the bytes; we
record `hashedAt = NULL` and let the integrity verifier backfill on
its next pass. The gap between confirm and first hash is bounded by
`INTEGRITY_VERIFIER_REVERIFY_DAYS` (default 30) — for files that need
faster hashing, the runbook documents flipping the cron's cadence.

### Why per-purpose TTL caps live in code, not config

We considered making the TTL cap an entry on `RetentionPolicy` so it
could be edited per-purpose. Rejected: the URL TTL is a security
control, not a policy decision — it caps how long a leaked URL is
useful. Letting it be edited at runtime gives a compromised admin a
trivial path to "fix" their problem. Defaults in code, change via
deploy.

### Erasure: `subject_email_snapshot` is the only PII we keep

When a user requests erasure of their account, we redact the User
row's PII fields (email, names, phone). But the `data_erasure_requests`
row itself snapshots the email at request time. Why?

* **Regulator audit.** "Prove you processed this user's request" requires
  showing *which user* — and after redaction, the User row says
  `redacted-{uuid}@erased.local`. Without the snapshot, the link from
  request → user is gone.
* **Reversibility window.** During the 24h cooldown, the snapshot lets
  support staff confirm "yes, this is the request I'm looking at"
  before honouring a cancellation.

The snapshot lives only on the request row. The retention policies
on `data_erasure_requests` (yet to be configured) decide how long
that record survives.

### Soft-delete vs hard-delete for retention

`RetentionAction` currently has three values: DELETE, ARCHIVE, REDACT.
DELETE today is a soft-delete on the File metadata row (sets
`deletedAt` + `status = DELETED`); the bytes in object storage are
also unlinked, but the row itself stays. This matters because:

* Audit trails (`file_attachments`) still reference the file ID. A
  hard delete cascades into history.
* The `RetentionExecution` row keeps the policy + timestamp + hash
  (via copy at execution time, future PR), so we can prove "we deleted
  this on this date" even after the metadata row eventually drops.

Hard deletion is reserved for the erasure flow (PR 7.4): a regulator
notice with `ADMIN_ACTION` source can request a true hard-delete. The
erasure service writes "deleted" into the outcome JSON and removes
the row.

### `enteredStatusAt` for retention is `createdAt` for now

The retention enforcer keys off `FileMetadata.createdAt`, which means
a file that's been re-attached to a new resource doesn't reset its
clock. That's intentional — retention is "how long did this byte
exist?" not "how long has it been useful?". When we want
attached-resource-driven retention (e.g. "delete dispute evidence 90
days after the dispute closes"), the next iteration adds a join-aware
policy class.

## Consequences

* The integrity verifier currently emits `file.integrity.backfill_pending`
  events instead of fetching+hashing inline. Provider-specific
  download wiring lands in the integrations follow-up — until then,
  the cron is observability-only for backfill but fully operational
  for re-verification of files that were hashed at upload.
* Compliance teams get one table per concern — `retention_policies` for
  retention, `data_erasure_requests` for erasure, `retention_executions`
  / `file_url_audits` for audit. No "see also" detective work.
* `FileUrlAuditService` is now in the issue path of every secure URL
  read. It's a single Postgres insert + a count, ~5ms; for a high-RPS
  read-heavy file like a public banner we'd skip the audit (callers can
  pass a `bypassAudit=true` flag in a future PR — but every PRIVATE
  file goes through the audit unconditionally).
* GDPR readiness: the 24h cooldown + structured outcome JSON +
  blocker-aware rejection give us a defensible posture without a flag
  day. Compliance team owns flipping `ERASURE_PROCESSOR_ENABLED=true`.

## Alternatives considered

* **Inline hash on the S3 confirm path** — would force a re-fetch of
  the bytes we just wrote. Doubles the upload latency. Rejected.
* **Object-store-side checksum (S3 ETag, Cloudinary signature)** —
  ETag is MD5, not safe for tamper detection. Cloudinary's signature
  proves the URL came from us, not that the bytes are unchanged.
  Self-managed SHA-256 is the only auditable option.
* **Per-actor erasure tables** (`user_erasure_requests`,
  `seller_erasure_requests`) — three migrations to maintain three
  tables. Single `data_erasure_requests` keyed on `(subjectType,
  subjectId)` is a tiny generalisation that pays off on day one
  (one queue, one cron, one runbook).
* **Letting clients pass their own SHA-256 in the upload-intent**
  instead of re-hashing on confirm — moves trust to the client.
  Rejected for the same reason we don't trust client-side validation:
  a malicious uploader could send "here's the hash of the bytes you
  expect, but I'll upload different bytes." Re-hashing server-side is
  the only option.

## Migration / rollout

* Apply migrations 20260506100000 (hash columns), 20260506110000
  (retention), 20260506120000 (URL audit), 20260506130000 (erasure).
* Soak each cron in turn, all flags off by default:
  1. `INTEGRITY_VERIFIER_ENABLED=true` first — purely observational.
     Watch the log for `backfilled` / `reverified` / `violations`.
  2. `RETENTION_ENFORCER_ENABLED=true` with `RETENTION_ENFORCER_DRY_RUN=true`.
     Read `retention_executions` to see what *would* be acted on.
     Sign off, then flip `RETENTION_ENFORCER_DRY_RUN=false`.
  3. `ERASURE_PROCESSOR_ENABLED=true` — wait for compliance sign-off
     on the outcome shape before flipping.
* Operational runbook:
  [docs/runbooks/phase-7-evidence-retention-erasure.md](../runbooks/phase-7-evidence-retention-erasure.md).
