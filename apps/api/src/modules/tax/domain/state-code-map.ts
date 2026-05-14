// Phase 2 — state-name → GST 2-digit code helper.
//
// Customer addresses store `state` as free text (e.g. "Karnataka",
// "TAMIL NADU"). The tax module needs a canonical 2-digit GST state
// code. This helper normalises and looks up against the india_states
// master.
//
// Service-layer code passes in a Map<normalizedName, gstCode> built
// once at startup (cached). Pure function makes it testable.

/**
 * Normalise a state name for comparison: uppercase, trim, collapse
 * whitespace, strip diacritics (none in canonical CBIC list but
 * future-proof).
 */
export function normalizeStateName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Look up a state name against a pre-built index map.
 * Returns null if no match.
 */
export function lookupStateCodeByName(
  name: string | null | undefined,
  index: ReadonlyMap<string, string>,
): string | null {
  const key = normalizeStateName(name);
  if (!key) return null;
  return index.get(key) ?? null;
}

/**
 * Extract a state code from an address-shaped object. Tries multiple
 * common field names. Returns null if none match.
 *
 * Order of precedence:
 *   1. addr.stateCode    — explicit GST code (preferred)
 *   2. addr.gstStateCode — alternate field name
 *   3. lookupStateCodeByName(addr.state, index)
 *      — fallback for legacy free-text state names
 */
export function extractStateCodeFromAddress(
  addr: unknown,
  index: ReadonlyMap<string, string>,
): { stateCode: string | null; source: 'stateCode' | 'gstStateCode' | 'stateName' | null } {
  if (typeof addr !== 'object' || addr === null) {
    return { stateCode: null, source: null };
  }
  const a = addr as Record<string, unknown>;
  if (typeof a.stateCode === 'string' && /^[0-9]{2}$/.test(a.stateCode)) {
    return { stateCode: a.stateCode, source: 'stateCode' };
  }
  if (typeof a.gstStateCode === 'string' && /^[0-9]{2}$/.test(a.gstStateCode)) {
    return { stateCode: a.gstStateCode, source: 'gstStateCode' };
  }
  if (typeof a.state === 'string') {
    const code = lookupStateCodeByName(a.state, index);
    if (code) return { stateCode: code, source: 'stateName' };
  }
  return { stateCode: null, source: null };
}

/**
 * Build a name → code lookup map from india_states rows. Used by the
 * place-of-supply service on bootstrap and cached.
 */
export function buildStateIndex(rows: Array<{ gstStateCode: string; stateName: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    m.set(normalizeStateName(r.stateName), r.gstStateCode);
  }
  return m;
}
