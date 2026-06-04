/**
 * Delhivery label (packing-slip) wire shapes.
 *
 * `GET /api/p/packing_slip?wbns=<csv>&pdf=true&pdf_size=A4`
 *
 * Query params:
 *   • wbns      (required) — comma-separated AWBs. Cap at 100.
 *   • pdf       (optional) — "true" returns an S3 PDF link; "false"
 *                            returns JSON for custom rendering.
 *                            Default true.
 *   • pdf_size  (optional) — "A4" (8x11) | "4R" (4x6). Default A4.
 */

export type DelhiveryLabelPdfSize = 'A4' | '4R';

export interface DelhiveryLabelRequest {
  /** Comma-separated AWBs. Delhivery caps at 100 per call. */
  wbns: string;
  /** "true" => PDF; "false" => JSON. */
  pdf?: 'true' | 'false';
  /** A4 (8x11, default) or 4R (4x6). */
  pdf_size?: DelhiveryLabelPdfSize;
}

/**
 * `pdf=true` envelope. Delhivery hosts the PDF on S3 and returns the
 * link. VERIFIED against staging (2026-06-03): the link is nested
 * PER-AWB under `packages[].pdf_download_link` (with an inline base64
 * `pdf_encoding` alongside it), NOT at the top level. A few accounts /
 * older docs surface it at the top level, so the parser checks both.
 */
export interface DelhiveryLabelPdfResponse {
  /** Count of slips Delhivery generated. */
  packages_found?: number;
  /** Top-level S3 link — only some accounts return it here. */
  pdf_download_link?: string;
  /** Alternate top-level field name some accounts see. */
  url?: string;
  /**
   * The real shape: one entry per AWB, each carrying its own S3
   * `pdf_download_link` (24h presigned) + inline base64 `pdf_encoding`,
   * keyed by `wbn`.
   */
  packages?: Array<{
    wbn?: string;
    status?: string;
    pdf_download_link?: string;
    pdf_encoding?: string;
  }>;
  /** Failure detail. */
  error?: unknown;
}

/**
 * `pdf=false` envelope. Returns per-AWB JSON for custom slip
 * rendering on our side (e.g. branded thermal labels).
 */
export interface DelhiveryLabelJsonResponse {
  packages?: Array<{
    wbn?: string;
    consignee?: {
      name?: string;
      address?: string;
      city?: string;
      state?: string;
      pin?: string;
      phone?: string;
    };
    shipper?: {
      name?: string;
      address?: string;
      city?: string;
      state?: string;
      pin?: string;
    };
    weight?: number;
    sort_code?: string;
    barcode?: string;
    payment_mode?: string;
    cod_amount?: number;
  }>;
  error?: unknown;
}

export type DelhiveryLabelResponse =
  | DelhiveryLabelPdfResponse
  | DelhiveryLabelJsonResponse;

/* ─── Canonical (facade-side) ──────────────────────────────────── */

/**
 * Canonical label result returned by the service. The mapper folds
 * either PDF or JSON Delhivery responses into this shape so callers
 * don't branch on format.
 */
export interface DelhiveryCanonicalLabelResult {
  /** S3 URL when format=pdf; undefined for json. */
  fileUrl?: string;
  /** "pdf" | "json" — what got produced. */
  format: 'pdf' | 'json';
  /** Echo of the AWB list. */
  awbs: string[];
  /** Raw JSON payload when format=json. */
  rawJson?: DelhiveryLabelJsonResponse;
}
