import type { LogisticsErrorCode } from '@sportsmart/logistics-contracts';
import type {
  DelhiveryCreateShipmentPackage,
  DelhiveryCreateShipmentResponse,
} from '../dtos/delhivery-create-shipment.dto';

/**
 * Translate Delhivery's many error shapes into a canonical
 * `MappedError`. The mapper is the boundary at which Delhivery-specific
 * vocabulary ("ClientWarehouseMatchingQueryDoesNotExist", "Invalid
 * Pincode", "Duplicate order", "Shipment not in editable state",
 * "Previous pickup request not closed") becomes caller-friendly codes
 * (`PARTNER_REJECTED`, `VALIDATION_FAILED`, `NOT_SERVICEABLE`,
 * `INVALID_STATE`, `BUSY`).
 *
 * Pattern mirrors `apps/logistics-facade/src/integrations/shadowfax/mappers/shadowfax-error.mapper.ts`.
 */

/**
 * Canonical error envelope thrown by the order service.
 *
 * `code` maps to one of the facade's `LogisticsErrorCode` values so
 * downstream services (apps/api consumers, BI) never see partner
 * vocabulary.
 */
export interface MappedError {
  code: LogisticsErrorCode;
  /** Human-readable detail; usually the partner's raw message. */
  detail: string;
  /** Whether the caller should consider a retry. */
  retryable: boolean;
  /**
   * Populated when the partner rejection means "this order already
   * exists — here is the original AWB". The service uses this to
   * surface the existing booking instead of erroring out.
   */
  originalAwbIfDuplicate?: string;
}

/**
 * Public entry point. Accepts the HTTP status and the parsed body
 * (typed as `unknown` because failures may not match the success DTO
 * shape — e.g. 4xx returns plain text, or a 200 surfaces an HTML SPA
 * fallback when the URL is wrong).
 *
 * Routing rules:
 *   • HTTP 401 / 403  -> UNAUTHORIZED   (also matches "Login or API Key Required")
 *   • HTTP 429        -> RATE_LIMITED
 *   • HTTP 5xx        -> PARTNER_DOWN
 *   • HTTP 200 + HTML body                                 -> PARTNER_DOWN ("wrong URL")
 *   • HTTP 200 + success=false / no packages                -> classify by remark
 *   • HTTP 4xx text   -> VALIDATION_FAILED (preserve detail)
 *   • Anything else   -> PARTNER_REJECTED
 *
 * Per-package failure remarks we recognise:
 *   • "ClientWarehouseMatchingQueryDoesNotExist" -> VALIDATION_FAILED + warehouse hint
 *   • "warehouse not registered/found"            -> VALIDATION_FAILED + warehouse hint
 *   • /duplicate.*order/i                         -> IDEMPOTENT_REPLAY
 *   • /pincode/i                                  -> NOT_SERVICEABLE
 *   • /missing.*required/i                        -> VALIDATION_FAILED
 *   • /not.*editable|not.*allowed.*(state|status)/-> INVALID_STATE
 *   • /previous.*pickup.*not.*closed/             -> BUSY
 *   • /pickup.*already.*(raised|pending)/         -> BUSY
 *   • /e-?way.*bill/.+invalid|format/             -> VALIDATION_FAILED
 *   • /nsl.*not.*eligible/                        -> INVALID_STATE
 *   • everything else                             -> PARTNER_REJECTED
 */
export function mapDelhiveryError(
  httpStatus: number,
  body: unknown,
): MappedError {
  // ── Transport-level errors ───────────────────────────────────────
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: 'UNAUTHORIZED',
      detail: extractAuthDetail(body, httpStatus),
      retryable: false,
    };
  }

  if (httpStatus === 429) {
    return {
      code: 'RATE_LIMITED',
      detail: 'Delhivery rate-limited the caller (HTTP 429).',
      retryable: true,
    };
  }

  if (httpStatus >= 500) {
    return {
      code: 'PARTNER_DOWN',
      detail: `Delhivery upstream error (HTTP ${httpStatus}).`,
      retryable: true,
    };
  }

  // ── HTTP 200 but the body is HTML (SPA fallback) ─────────────────
  // Common when the URL is wrong — Delhivery serves the One portal
  // SPA on bad paths instead of an API error.
  if (looksLikeHtml(body)) {
    return {
      code: 'PARTNER_DOWN',
      detail:
        'Likely wrong URL — Delhivery returned HTML instead of JSON. ' +
        'Verify DELHIVERY_API_URL and the requested path.',
      retryable: false,
    };
  }

  // ── HTTP 200 / 4xx with a JSON envelope ─────────────────────────
  if (isObject(body)) {
    const envelope = body as DelhiveryCreateShipmentResponse & {
      message?: unknown;
      remark?: unknown;
      remarks?: unknown;
    };

    // Per-package failure — surface the most specific remark.
    const failurePackage = (envelope.packages ?? []).find(
      (p) => (p.status ?? 'Success') !== 'Success' || !p.waybill,
    );
    if (failurePackage) {
      return classifyPackageFailure(failurePackage, envelope);
    }

    // Envelope-level "success: false" with no per-package detail —
    // dig into top-level error / rmk / message / remarks strings.
    if (envelope.success === false || !envelope.packages) {
      const text = flattenErrorText({
        error: envelope.error,
        rmk: envelope.rmk,
        message: envelope.message,
        remark: envelope.remark,
        remarks: envelope.remarks,
      });
      // Even with no packages array, only treat as a failure if there
      // IS some error indicator. Some success envelopes (e.g.
      // serviceability) legitimately have no `packages` field.
      if (text || envelope.success === false || envelope.error) {
        return classifyFailureText(text, envelope);
      }
    }
  }

  // ── HTTP 4xx with non-JSON body — preserve the detail. ──────────
  if (httpStatus >= 400 && httpStatus < 500) {
    return {
      code: 'VALIDATION_FAILED',
      detail:
        truncate(stringify(body), 500) ||
        `Delhivery ${httpStatus} with no error detail.`,
      retryable: false,
    };
  }

  // ── Unknown shape — surface the raw body as best-effort detail. ──
  return {
    code: 'PARTNER_REJECTED',
    detail: `Unrecognised Delhivery response (HTTP ${httpStatus}): ${truncate(
      stringify(body),
      500,
    )}`,
    retryable: false,
  };
}

/* ─── Private helpers ────────────────────────────────────────────── */

function classifyPackageFailure(
  pkg: DelhiveryCreateShipmentPackage,
  envelope: DelhiveryCreateShipmentResponse,
): MappedError {
  const text = flattenErrorText({
    remarks: pkg.remarks,
    error: envelope.error,
    rmk: envelope.rmk,
  });
  return classifyFailureText(text, envelope, pkg);
}

function classifyFailureText(
  text: string,
  envelope: DelhiveryCreateShipmentResponse,
  pkg?: DelhiveryCreateShipmentPackage,
): MappedError {
  const t = text.trim();

  // Missing / invalid waybill — surface validation rather than carrier rejection.
  if (
    /(missing|invalid|no\s+such)\s+waybill/i.test(t) ||
    /waybill.*(not\s+found|does\s+not\s+exist|required)/i.test(t)
  ) {
    return {
      code: 'VALIDATION_FAILED',
      detail: `Delhivery rejected the waybill: ${t}`,
      retryable: false,
    };
  }

  // Editable-state guard — Delhivery refuses edit/cancel on terminal states.
  if (
    /not\s+(in\s+)?editable/i.test(t) ||
    /not\s+allowed.*(state|status)/i.test(t) ||
    /(delivered|rto|lost|closed|dto).*(cannot|not\s+allowed|invalid)/i.test(t)
  ) {
    return {
      code: 'INVALID_STATE',
      detail: `Delhivery shipment not in editable state: ${t}`,
      retryable: false,
    };
  }

  // Pickup request — previous request not closed for the warehouse / day.
  if (
    /pickup.*(previous|already.*(raised|pending)).*(not\s+closed|open)?/i.test(t) ||
    /previous.*pickup.*request.*not.*closed/i.test(t) ||
    /pickup.*already.*(raised|exists|pending)/i.test(t)
  ) {
    return {
      code: 'BUSY',
      detail: `Delhivery pickup request blocked — previous request still open: ${t}`,
      retryable: true,
    };
  }

  // E-way bill — invalid format.
  if (/e-?way.*bill/i.test(t) && /(invalid|format|incorrect)/i.test(t)) {
    return {
      code: 'VALIDATION_FAILED',
      detail: `Delhivery rejected the e-way bill (invalid format): ${t}`,
      retryable: false,
    };
  }

  // NDR — NSL code not eligible for the requested action.
  if (
    /nsl/i.test(t) && /(not\s+eligible|invalid|disallowed)/i.test(t)
  ) {
    return {
      code: 'INVALID_STATE',
      detail: `Delhivery NDR action rejected — current NSL not eligible: ${t}`,
      retryable: false,
    };
  }

  // Wrong pickup_location.name — the most common Delhivery failure.
  if (
    /clientwarehouse.*matching.*query.*does.*not.*exist/i.test(t) ||
    /warehouse.*not.*(registered|found|exist)/i.test(t)
  ) {
    return {
      code: 'VALIDATION_FAILED',
      detail:
        `Delhivery rejected the pickup_location.name — it must exactly match ` +
        `a warehouse registered in the Delhivery One panel (case + space ` +
        `sensitive). Raw: ${t || 'ClientWarehouseMatchingQueryDoesNotExist'}`,
      retryable: false,
    };
  }

  // Duplicate order — Delhivery returns the original AWB inline when
  // the same `order` was already booked.
  if (
    /duplicate.*order/i.test(t) ||
    /already.*manifested/i.test(t) ||
    /already.*exists/i.test(t)
  ) {
    const existingAwb = pkg?.waybill ?? extractAwbFromText(t);
    return {
      code: 'IDEMPOTENT_REPLAY',
      detail:
        `Delhivery already has a shipment for this order id` +
        (existingAwb ? ` (AWB ${existingAwb})` : '') +
        `: ${t}`,
      retryable: false,
      originalAwbIfDuplicate: existingAwb,
    };
  }

  // Invalid / not-serviceable pincode.
  if (/pincode/i.test(t) && /(invalid|not.*serviceable|unservic|nsz)/i.test(t)) {
    return {
      code: 'NOT_SERVICEABLE',
      detail: `Delhivery pincode rejected: ${t}`,
      retryable: false,
    };
  }

  // Missing required field.
  if (/(missing|required).*(field|param)/i.test(t) || /is\s+required/i.test(t)) {
    return {
      code: 'VALIDATION_FAILED',
      detail: `Delhivery validation failed (missing field): ${t}`,
      retryable: false,
    };
  }

  // Weight over carrier limit.
  if (/weight/i.test(t) && /(exceed|over|limit)/i.test(t)) {
    return {
      code: 'WEIGHT_OVER_CARRIER_LIMIT',
      detail: `Delhivery rejected weight: ${t}`,
      retryable: false,
    };
  }

  // COD amount mismatch.
  if (/cod/i.test(t) && /(mismatch|invalid|amount)/i.test(t)) {
    return {
      code: 'COD_AMOUNT_MISMATCH',
      detail: `Delhivery rejected COD amount: ${t}`,
      retryable: false,
    };
  }

  // Auth surfaced inside the body (Delhivery does this on 200 too).
  if (
    /(login|api\s*key).*required/i.test(t) ||
    /authentication/i.test(t) ||
    /unauthori[sz]ed/i.test(t)
  ) {
    return {
      code: 'UNAUTHORIZED',
      detail: `Delhivery authentication error: ${t}`,
      retryable: false,
    };
  }

  // Suppress envelope variable warning on success paths.
  void envelope;

  // Default — preserve the partner detail under PARTNER_REJECTED.
  return {
    code: 'PARTNER_REJECTED',
    detail: t || 'Delhivery returned success=false with no detail.',
    retryable: false,
  };
}

function extractAuthDetail(body: unknown, httpStatus: number): string {
  const text = isString(body) ? body : flattenErrorText(body);
  if (/login.*or.*api\s*key.*required/i.test(text)) {
    return `Delhivery rejected the API token: "Login or API Key Required" (HTTP ${httpStatus}).`;
  }
  return `Delhivery rejected the API token (HTTP ${httpStatus}).`;
}

function looksLikeHtml(body: unknown): boolean {
  if (!isString(body)) return false;
  const head = body.trimStart().slice(0, 100).toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<head')
  );
}

function flattenErrorText(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input
      .map((entry) => (typeof entry === 'string' ? entry : stringify(entry)))
      .filter(Boolean)
      .join(' ');
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const parts: string[] = [];
    for (const [field, value] of Object.entries(obj)) {
      const flat = flattenErrorText(value);
      if (flat) parts.push(`${field}: ${flat}`);
    }
    return parts.join(' | ');
  }
  return String(input);
}

function extractAwbFromText(text: string): string | undefined {
  // Delhivery AWBs are typically 13-15 digit numerics; sometimes
  // surfaced as "waybill XXXXX" or "AWB XXXXX" in remark strings.
  const match = text.match(/(?:waybill|awb)[\s:=]+([A-Z0-9]{8,20})/i);
  return match?.[1];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
