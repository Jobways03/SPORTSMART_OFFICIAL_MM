/**
 * Phase 9 (PR 9.2) — Locale resolution.
 *
 * Pure helper: takes a request-style input (Accept-Language header
 * + optional per-user preferred locale + optional explicit override)
 * and returns the resolved BCP-47 tag plus the fallback chain.
 *
 * Resolution order:
 *   1. Explicit override (e.g. ?locale=hi).
 *   2. User profile preferred locale.
 *   3. Accept-Language header (q-weighted).
 *   4. DEFAULT_LOCALE.
 *
 * Fallback chain example: "en-IN" → ["en-IN", "en", DEFAULT_LOCALE].
 */

const DEFAULT_LOCALE = 'en';
const SUPPORTED = new Set([
  'en',
  'en-IN',
  'hi',
  'hi-IN',
  'ta',
  'ta-IN',
  'kn',
  'kn-IN',
  'mr',
  'mr-IN',
]);

export interface ResolveInput {
  override?: string | null;
  userPreferred?: string | null;
  acceptLanguage?: string | null;
}

export interface ResolvedLocale {
  /** Best-match locale we'll render in. */
  locale: string;
  /** Ordered fallback list — first hit in the catalogue wins. */
  fallbackChain: string[];
}

export function resolveLocale(input: ResolveInput): ResolvedLocale {
  const candidates: string[] = [];

  if (input.override) candidates.push(normalize(input.override));
  if (input.userPreferred) candidates.push(normalize(input.userPreferred));
  if (input.acceptLanguage) {
    for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
      candidates.push(normalize(tag));
    }
  }
  candidates.push(DEFAULT_LOCALE);

  // Best supported match: walk candidates, return the first whose
  // exact form OR base language is supported.
  for (const c of candidates) {
    if (!c) continue;
    if (SUPPORTED.has(c)) {
      return { locale: c, fallbackChain: chainFor(c) };
    }
    const base = c.split('-')[0]!;
    if (SUPPORTED.has(base)) {
      return { locale: base, fallbackChain: chainFor(base) };
    }
  }
  return { locale: DEFAULT_LOCALE, fallbackChain: [DEFAULT_LOCALE] };
}

function chainFor(locale: string): string[] {
  const out: string[] = [locale];
  if (locale.includes('-')) {
    const base = locale.split('-')[0]!;
    if (base !== locale) out.push(base);
  }
  if (!out.includes(DEFAULT_LOCALE)) out.push(DEFAULT_LOCALE);
  return out;
}

function normalize(tag: string): string {
  // BCP-47 is case-insensitive on language; case-significant on script
  // ("zh-Hant"). For the small set we support today, lowercasing the
  // language and uppercasing the region works.
  const m = /^([a-zA-Z]+)(?:-([a-zA-Z]+))?$/.exec(tag.trim());
  if (!m || !m[1]) return tag;
  const lang = m[1].toLowerCase();
  const region = m[2]?.toUpperCase();
  return region ? `${lang}-${region}` : lang;
}

/** Lightweight Accept-Language parser. Returns highest-q first. */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      let q = 1;
      for (const p of params) {
        const [k, v] = p.trim().split('=');
        if (k === 'q' && v !== undefined) q = parseFloat(v);
      }
      return { tag: tag?.trim() ?? '', q };
    })
    .filter((x) => x.tag && !isNaN(x.q))
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

export const I18N_DEFAULT_LOCALE = DEFAULT_LOCALE;
export const I18N_SUPPORTED_LOCALES = Array.from(SUPPORTED);
