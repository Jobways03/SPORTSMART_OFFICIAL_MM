import {API_BASE} from '../lib/api-client';
import {keychainStorage} from '../lib/storage';

/**
 * DPDP §13 customer-data export.
 *
 * The endpoint is unusual — it bypasses the global `{success, message,
 * data}` envelope and returns the raw JSON dump directly with
 * `Content-Disposition: attachment` so a browser saves it as a file.
 *
 * That means we can't go through `apiClient` (which assumes the
 * envelope shape). Instead we do a raw authenticated fetch, get the
 * JSON as text, and hand it to the caller for whatever it wants to do
 * — typically a `data:application/json` URL opened in the system
 * browser so the user can save/share it.
 *
 * Rate-limited server-side to 3 requests per hour (per Throttle).
 */
export interface DataExportRaw {
  /** The full JSON payload as a string — preserves BigInt-as-string
   *  fields the server formatted, and avoids re-stringifying. */
  jsonText: string;
  /** Best-effort size readout for the UI. */
  byteSize: number;
}

export const dataExportService = {
  async request(): Promise<DataExportRaw> {
    const token = await keychainStorage.getItem('accessToken');
    const res = await fetch(`${API_BASE}/api/v1/customer/data-export`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
      },
    });
    if (!res.ok) {
      // Try to surface a useful message from the error body.
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        const parsed = JSON.parse(text);
        detail = parsed?.message || detail;
      } catch {
        // ignore
      }
      throw new Error(`Data export failed: ${detail}`);
    }
    const jsonText = await res.text();
    return {jsonText, byteSize: jsonText.length};
  },
};

/**
 * Build a `data:` URL the system browser can open + save as a JSON
 * file. Caps at ~2 MB because some platforms refuse to open data URLs
 * larger than that. For bigger exports the user will need the web
 * version of this flow.
 */
export const MAX_DATA_URL_BYTES = 2 * 1024 * 1024;

export function buildDataUrl(jsonText: string): string {
  return (
    'data:application/json;charset=utf-8,' + encodeURIComponent(jsonText)
  );
}

/**
 * Web-only delivery. Chrome (and other browsers) BLOCK top-level
 * navigation to `data:` URLs for security, so opening the data URL in a
 * new tab just yields a blank page. Instead we wrap the JSON in a Blob,
 * mint an object URL, and click a hidden `<a download>` to save the file
 * directly. Blob URLs aren't subject to the data:-URL block, so there's
 * also no 2 MB cap here. Returns the `blob:` URL so the caller can stash
 * it for a "re-open" affordance (blob: navigation IS allowed).
 */
export function downloadJsonWeb(jsonText: string): string {
  const blob = new Blob([jsonText], {type: 'application/json'});
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `sportsmart-data-export-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Intentionally NOT revoked — keeps "Open last export" working this
  // session; the URL is reclaimed on page unload.
  return blobUrl;
}
