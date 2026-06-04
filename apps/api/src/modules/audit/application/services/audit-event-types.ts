/**
 * Phase 205 — canonical audit event-type vocabulary.
 *
 * The 27 audit callers pass `module` / `action` / `actorType` as free-text,
 * which produced same-domain drift (`wallet` vs `wallets`), three action
 * naming styles (`order.cancelled`, `ORDER_CANCELLED`, `cancel_order`), and a
 * FE that filters on values that may or may not exist.
 *
 * This file is the SINGLE SOURCE OF TRUTH for the intended vocabulary. Because
 * migrating all 27 callers + backfilling historic rows to strict enums is a
 * large, deploy-coordinated change (HONEST-CALL — see notes), the `module` and
 * `action` COLUMNS stay `String`; only the brand-new `actorType` column is a DB
 * enum. The facade validates against these lists in TOLERANT mode: a recognised
 * value passes silently, an unrecognised one is accepted but logged as drift so
 * we can drive the value down to zero before flipping to strict.
 */

// ── Actor type — mirrors the Prisma AuditActorType enum exactly. ────────────
export const AUDIT_ACTOR_TYPES = [
  'CUSTOMER',
  'ADMIN',
  'SELLER',
  'FRANCHISE',
  'AFFILIATE',
  'SYSTEM',
  'CRON',
  'WEBHOOK',
  'PAYMENT_PROVIDER',
  'LOGISTICS_PROVIDER',
] as const;
export type AuditActorTypeValue = (typeof AUDIT_ACTOR_TYPES)[number];

const ACTOR_TYPE_SET = new Set<string>(AUDIT_ACTOR_TYPES);
export function isKnownActorType(v: string): v is AuditActorTypeValue {
  return ACTOR_TYPE_SET.has(v);
}

// ── Canonical module vocabulary. Lowercase, SINGULAR domain noun. ───────────
// #205 (#2) — `wallet` is canonical; `wallets` is the deprecated alias. The
// wallet module is owned by another agent, so the canonical value is SURFACED
// here for the central reconcile rather than rewritten in that module.
export const AUDIT_MODULES = [
  'orders',
  'payments',
  'refunds',
  'returns',
  'disputes',
  'wallet',
  'settlements',
  'reconciliation',
  'catalog',
  'discounts',
  'sellers',
  'franchise',
  'affiliate',
  'identity',
  'consent',
  'tax',
  'access',
  'audit',
  'notifications',
  'support',
  'logistics',
] as const;
export type AuditModuleValue = (typeof AUDIT_MODULES)[number];

// Known deprecated → canonical aliases. #205 (#10) — accept the alias, record
// the canonical so reports can normalise; the producing module is migrated
// separately.
export const AUDIT_MODULE_ALIASES: Record<string, AuditModuleValue> = {
  wallets: 'wallet',
};

const MODULE_SET = new Set<string>(AUDIT_MODULES);
export function isKnownModule(v: string): boolean {
  return MODULE_SET.has(v) || v in AUDIT_MODULE_ALIASES;
}
export function canonicalModule(v: string): string {
  return AUDIT_MODULE_ALIASES[v] ?? v;
}

// ── Canonical action verbs. dot.case, `<noun>.<verb>` past tense. ───────────
// Not exhaustive (actions are open-ended), but the recognised set is what the
// FE dropdown offers and what the drift detector measures coverage against.
export const AUDIT_ACTION_PREFIXES = [
  'created',
  'updated',
  'deleted',
  'approved',
  'rejected',
  'cancelled',
  'refunded',
  'settled',
  'verified',
  'exported',
  'viewed',
  'reassigned',
  'suspended',
  'restored',
] as const;

// Self-audited audit actions (Phase 204 #4 / 206 #2).
export const AUDIT_SELF_ACTIONS = {
  CHAIN_VERIFIED: 'audit.chain.verified',
  CHAIN_BREAK_DETECTED: 'audit.chain.break_detected',
  EXPORTED: 'audit.exported',
} as const;
