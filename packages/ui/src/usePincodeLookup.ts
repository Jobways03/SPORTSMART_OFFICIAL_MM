'use client';

import { useState } from 'react';

export interface PincodeLookupResult {
  district: string;
  state: string;
  places?: { name: string }[];
}

function resolveApiBase(): string {
  const env =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_API_URL
      : undefined;
  return env || 'http://localhost:8000';
}

/**
 * Default lookup — hits the PUBLIC `GET /api/v1/pincodes/:pincode` endpoint
 * directly (no auth required). Consumers that want to route through their own
 * api-client can pass a `lookup` argument instead.
 */
export async function defaultPincodeLookup(
  pincode: string,
): Promise<PincodeLookupResult | null> {
  const res = await fetch(`${resolveApiBase()}/api/v1/pincodes/${pincode}`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: PincodeLookupResult }
    | null;
  return body?.success ? body.data ?? null : null;
}

const NOT_FOUND_MSG =
  "We couldn't find that PIN code — please enter the city & state.";
const UNAVAILABLE_MSG =
  'PIN lookup is unavailable right now — please enter the city & state.';

/**
 * Shared 6-digit Indian PIN → district/state/post-office lookup logic.
 *
 * This is the one source of truth for the lookup itself (the fetch + the
 * loading / error / hint / places / auto-filled state). The styled
 * `<PincodeFields>` component uses it, and so do bespoke address forms (e.g.
 * the storefront checkout) that need the same behaviour but their own markup.
 *
 * `lookup(raw)` cleans the input, fetches when it reaches 6 digits, updates the
 * exposed state, and RETURNS the result so the caller can map district/state
 * onto its own form shape. It resolves to `null` on a short/invalid/failed PIN.
 */
export function usePincodeLookup(
  lookup: (pincode: string) => Promise<PincodeLookupResult | null> = defaultPincodeLookup,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const [autoFilled, setAutoFilled] = useState(false);
  const [result, setResult] = useState<PincodeLookupResult | null>(null);

  function reset() {
    setLoading(false);
    setError('');
    setHint('');
    setPlaces([]);
    setAutoFilled(false);
    setResult(null);
  }

  async function run(raw: string): Promise<PincodeLookupResult | null> {
    const pincode = raw.replace(/\D/g, '').slice(0, 6);
    if (pincode.length !== 6) {
      reset();
      return null;
    }

    setLoading(true);
    setError('');
    try {
      const data = await lookup(pincode);
      if (data?.district) {
        setPlaces((data.places ?? []).map((p) => p.name).filter(Boolean));
        setHint(`${data.district}, ${data.state}`.toUpperCase());
        setAutoFilled(true);
        setResult(data);
        return data;
      }
      setError(NOT_FOUND_MSG);
      setPlaces([]);
      setHint('');
      setAutoFilled(false);
      setResult(null);
      return null;
    } catch {
      setError(UNAVAILABLE_MSG);
      setPlaces([]);
      setHint('');
      setAutoFilled(false);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  return {
    loading,
    error,
    hint,
    places,
    autoFilled,
    result,
    /** Run the lookup for a raw PIN string; returns the result (or null). */
    lookup: run,
    /** Clear all lookup state. */
    reset,
    /** Manually flip the auto-filled flag (e.g. when the user edits city/state). */
    setAutoFilled,
  };
}
