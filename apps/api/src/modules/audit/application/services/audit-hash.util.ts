import { createHash } from 'crypto';

/**
 * Phase 203 (#1) — the ONE canonical hash recipe, shared by the writer and
 * every verifier so a stored `hash` is exactly recomputable.
 *
 * The historic bug: the writer hashed over a write-time `new Date().toISOString()`
 * while the row's `created_at` was set independently by Prisma's `default(now())`.
 * The two diverged by however long the surrounding transaction took, so no
 * verifier could ever recompute the content hash — both just skipped it /
 * flagged it "informational", which means content tampering was UNDETECTABLE.
 *
 * The fix: generate ONE timestamp in code, write it explicitly into BOTH the
 * row's `created_at` AND the hash payload's `ts`. Verifiers recompute from the
 * STORED `created_at`. Schema-version 2 rows are content-verifiable; v1 (legacy)
 * rows used the old recipe and are skipped for content (linkage still checked).
 */

export const AUDIT_HASH_SCHEMA_VERSION = 2;

export interface AuditHashInput {
  actorId: string | null;
  actorRole: string | null;
  actorType: string | null;
  action: string;
  module: string;
  resource: string;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  /** The value that is ALSO written to the row's created_at column. */
  createdAt: Date;
}

/**
 * Build the canonical JSON string hashed for a v2 row. Field order is fixed
 * (this literal IS the contract); changing it requires a schemaVersion bump.
 */
export function canonicalAuditPayloadV2(input: AuditHashInput): string {
  return JSON.stringify({
    actorId: input.actorId,
    actorRole: input.actorRole,
    actorType: input.actorType,
    action: input.action,
    module: input.module,
    resource: input.resource,
    resourceId: input.resourceId,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: input.requestId,
    ts: input.createdAt.toISOString(),
  });
}

/** sha256(prevHash + '|' + canonicalPayload) — the chain link. */
export function computeAuditHash(prevHash: string | null, payload: string): string {
  return createHash('sha256')
    .update((prevHash ?? '') + '|' + payload)
    .digest('hex');
}

/**
 * Recompute the content hash of a STORED v2 row and compare to what's saved.
 * Returns null when the row is v1/legacy (not content-verifiable) so the caller
 * can skip rather than false-flag. Used by both verifiers.
 */
export function recomputeStoredRowHash(row: {
  actorId: string | null;
  actorRole: string | null;
  actorType: string | null;
  action: string;
  module: string;
  resource: string;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
  prevHash: string | null;
  schemaVersion: number;
  // Accepted (and ignored) so a caller can pass the WHOLE stored row — it
  // recomputes the hash and the caller compares the result to row.hash.
  hash?: string | null;
}): string | null {
  if (row.schemaVersion < AUDIT_HASH_SCHEMA_VERSION) return null;
  const payload = canonicalAuditPayloadV2({
    actorId: row.actorId,
    actorRole: row.actorRole,
    actorType: row.actorType,
    action: row.action,
    module: row.module,
    resource: row.resource,
    resourceId: row.resourceId,
    oldValue: row.oldValue,
    newValue: row.newValue,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt,
  });
  return computeAuditHash(row.prevHash, payload);
}
