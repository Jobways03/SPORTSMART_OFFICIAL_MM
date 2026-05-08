/**
 * Tiny JSON-condition matcher used by ResourcePolicy. Inspired by
 * MongoDB query operators but intentionally restricted to the subset
 * we need — no $and/$or/$not regex chains. The full operator list is
 * documented in authorization.prisma alongside the `conditions` field.
 *
 * A policy stores its conditions as JSON, e.g.:
 *   { "amountInPaise": { "$lte": 1000000 }, "originalPaymentMethod": "ONLINE" }
 *
 * We evaluate it against a flat context object built by the guard:
 *   { amountInPaise: 750000, originalPaymentMethod: "ONLINE" }
 *
 * Matching semantics:
 *   - All top-level keys must match (logical AND).
 *   - A scalar value uses $eq.
 *   - Operator-form values use the operator map below.
 *   - Missing context keys are evaluated as undefined.
 *
 * Returns true if the context satisfies the conditions, false otherwise.
 * NEVER throws — invalid operator forms are treated as no-match (false)
 * so a malformed policy fails closed rather than opening a hole.
 */

type Scalar = string | number | boolean | null;

type Operator =
  | { $eq: Scalar }
  | { $ne: Scalar }
  | { $in: Scalar[] }
  | { $nin: Scalar[] }
  | { $lt: number }
  | { $lte: number }
  | { $gt: number }
  | { $gte: number }
  | { $exists: boolean };

export type Conditions = Record<string, Scalar | Operator>;

const KNOWN_OPERATORS = new Set([
  '$eq', '$ne', '$in', '$nin', '$lt', '$lte', '$gt', '$gte', '$exists',
]);

export function matchesConditions(
  conditions: Conditions | null | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  for (const [key, expected] of Object.entries(conditions)) {
    const actual = context[key];
    if (!matchesField(expected, actual)) return false;
  }
  return true;
}

function matchesField(expected: unknown, actual: unknown): boolean {
  if (isOperatorObject(expected)) {
    return matchesOperator(expected as Record<string, unknown>, actual);
  }
  // Direct equality / identity.
  return actual === expected;
}

function isOperatorObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value as object);
  if (keys.length === 0) return false;
  return keys.every((k) => KNOWN_OPERATORS.has(k));
}

function matchesOperator(
  op: Record<string, unknown>,
  actual: unknown,
): boolean {
  for (const [k, v] of Object.entries(op)) {
    switch (k) {
      case '$eq':
        if (actual !== v) return false;
        break;
      case '$ne':
        if (actual === v) return false;
        break;
      case '$in':
        if (!Array.isArray(v) || !v.includes(actual as Scalar)) return false;
        break;
      case '$nin':
        if (!Array.isArray(v) || v.includes(actual as Scalar)) return false;
        break;
      case '$lt':
        if (typeof actual !== 'number' || typeof v !== 'number' || !(actual < v)) {
          return false;
        }
        break;
      case '$lte':
        if (typeof actual !== 'number' || typeof v !== 'number' || !(actual <= v)) {
          return false;
        }
        break;
      case '$gt':
        if (typeof actual !== 'number' || typeof v !== 'number' || !(actual > v)) {
          return false;
        }
        break;
      case '$gte':
        if (typeof actual !== 'number' || typeof v !== 'number' || !(actual >= v)) {
          return false;
        }
        break;
      case '$exists':
        if (typeof v !== 'boolean') return false;
        if (v && actual === undefined) return false;
        if (!v && actual !== undefined) return false;
        break;
      default:
        // Unknown operator → fail closed.
        return false;
    }
  }
  return true;
}
