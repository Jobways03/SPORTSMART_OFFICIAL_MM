import type { LogisticsErrorCode } from '@sportsmart/logistics-contracts';
import {
  isShadowfaxCreateOrderFailure,
  type ShadowfaxCreateOrderFailure,
} from '../dtos/shadowfax-create-shipment.dto';

/**
 * Canonical error envelope used by the adapter / order service.
 * `code` maps to one of the facade's `LogisticsErrorCode` values so
 * downstream services (apps/api consumers, BI) never see partner
 * vocabulary.
 *
 * Pattern mirrors apps/api/src/integrations/ithink/mappers/ithink-error.mapper.ts.
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
 * (typed as `unknown` because failures may not match
 * `ShadowfaxCreateOrderFailure` exactly — e.g. 5xx returns plain text
 * or an HTML error page).
 *
 * Note on Shadowfax error shapes: the failure envelope's `errors`
 * field can be a string, a string[], or an object with nested
 * string[] values. We flatten all three to a single space-joined
 * string before pattern-matching.
 *
 * The same mapper is reused across all four operations (create,
 * track, update, cancel). Operation-specific strings (Invalid AWB,
 * Multiple Orders found, Cannot cancel from Pincode Updated, etc.)
 * are routed to `VALIDATION_FAILED` with the raw partner message
 * preserved in `detail`.
 *
 * TODO: introduce dedicated `LogisticsErrorCode` values for the
 * common cancel + update sub-cases (`CANCEL_INVALID_STATE`,
 * `UPDATE_PINCODE_LIMIT_EXCEEDED`, `UPDATE_INTERCITY_NOT_ALLOWED`)
 * once the canonical error vocabulary is expanded.
 */
export function mapShadowfaxError(
  httpStatus: number,
  body: unknown,
): MappedError {
  // ── Transport-level errors ───────────────────────────────────────
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: 'UNAUTHORIZED',
      detail: `Shadowfax rejected the API token (HTTP ${httpStatus}).`,
      retryable: false,
    };
  }

  if (httpStatus === 429) {
    return {
      code: 'RATE_LIMITED',
      detail: 'Shadowfax rate-limited the caller (HTTP 429).',
      retryable: true,
    };
  }

  if (httpStatus >= 500 || httpStatus === 503) {
    return {
      code: httpStatus === 503 ? 'PARTNER_DOWN' : 'PARTNER_DOWN',
      detail: `Shadowfax upstream error (HTTP ${httpStatus}).`,
      retryable: true,
    };
  }

  // ── HTTP 400 special-cases ──────────────────────────────────────
  if (httpStatus === 400) {
    const flat = flattenErrorText(body);

    // Shadowfax suspends account access when invoices go past due. The
    // partner returns a 400 with a billing-issue body — we surface this
    // as a non-retryable `BILLING_ISSUE`-ish error so ops can resolve.
    //
    // NOTE: `BILLING_ISSUE` isn't yet in `LogisticsErrorCode` — closest
    // equivalent is `PARTNER_REJECTED`. Documented as a follow-up in
    // the README so we don't lose the requirement.
    if (/pending\s+invoices?/i.test(flat)) {
      return {
        code: 'PARTNER_REJECTED',
        detail: `Shadowfax billing issue: ${flat || 'pending invoices on account'}.`,
        retryable: false,
      };
    }

    // Tracking-side: invalid AWB.
    if (/invalid\s+awb/i.test(flat)) {
      return {
        code: 'AWB_NOT_FOUND',
        detail: `Shadowfax does not recognise this AWB: ${flat}`,
        retryable: false,
      };
    }

    // Bulk tracking: too many AWBs per call.
    if (/number\s+of\s+awbs?\s+exceeded/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax bulk-track limit exceeded (max 50 per call): ${flat}`,
        retryable: false,
      };
    }

    // Update-side: pincode change limit reached.
    // TODO: introduce dedicated UPDATE_PINCODE_LIMIT_EXCEEDED code.
    if (/pincode/i.test(flat) && /(exceed|limit|max)/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax update rejected — pincode change limit reached: ${flat}`,
        retryable: false,
      };
    }

    // Update-side: intercity pincode change not allowed.
    // TODO: introduce dedicated UPDATE_INTERCITY_NOT_ALLOWED code.
    if (/intercity/i.test(flat) && /pincode/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax update rejected — intercity pincode change not allowed: ${flat}`,
        retryable: false,
      };
    }

    // Update-side: customer already delivered.
    if (/already\s+delivered/i.test(flat)) {
      return {
        code: 'INVALID_FSM_TRANSITION',
        detail: `Shadowfax update rejected — order already delivered: ${flat}`,
        retryable: false,
      };
    }

    // Update-side: blank/missing contact.
    if (/contact/i.test(flat) && /(blank|required|missing)/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax update rejected — contact required: ${flat}`,
        retryable: false,
      };
    }

    // Cancel-side: invalid state to cancel from.
    // TODO: introduce dedicated CANCEL_INVALID_STATE code.
    if (/invalid\s+state/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax cancel rejected — invalid state: ${flat}`,
        retryable: false,
      };
    }

    // Cancel-side: AWB resolves to multiple orders.
    if (/multiple\s+orders/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax cancel rejected — multiple orders found: ${flat}`,
        retryable: false,
      };
    }

    // Cancel-side: shipment is in pincode-updated state.
    if (/cannot\s+cancel\s+from\s+pincode\s+updated/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax cancel rejected — order in Pincode Updated state: ${flat}`,
        retryable: false,
      };
    }

    // Cancel-side: generic "unable to cancel" fallback.
    if (/unable\s+to\s+cancel/i.test(flat)) {
      return {
        code: 'VALIDATION_FAILED',
        detail: `Shadowfax cancel rejected: ${flat}`,
        retryable: false,
      };
    }

    // Generic 400 — preserve the partner message.
    return {
      code: 'VALIDATION_FAILED',
      detail: flat || `Shadowfax 400 with no error detail.`,
      retryable: false,
    };
  }

  // ── HTTP 200 + message: "Failure" — Shadowfax's primary error shape
  if (isShadowfaxCreateOrderFailure(body)) {
    return classifyFailureBody(body);
  }

  // ── Unknown shape — surface the raw body as best-effort detail. ──
  return {
    code: 'PARTNER_REJECTED',
    detail: `Unrecognised Shadowfax response (HTTP ${httpStatus}): ${truncate(safeStringify(body), 500)}`,
    retryable: false,
  };
}

/* ─── Private helpers ────────────────────────────────────────────── */

function classifyFailureBody(body: ShadowfaxCreateOrderFailure): MappedError {
  const text = flattenErrorText(body.errors);

  // Order already exists. The duplicate AWB is sometimes echoed at
  // the top level (`AWB`) and sometimes embedded in the error text
  // (e.g. "already created with AWB SF1234567890").
  if (/already\s+exists/i.test(text) || /already\s+created/i.test(text)) {
    const awb = body.AWB ?? extractAwbFromText(text);
    return {
      code: 'IDEMPOTENT_REPLAY',
      detail:
        `Shadowfax already has an order for this client_order_id` +
        (awb ? ` (AWB ${awb})` : '') +
        `: ${text}`,
      retryable: false,
      originalAwbIfDuplicate: awb,
    };
  }

  // Pincode not serviceable.
  if (/pincode/i.test(text) && /not\s+serviceable/i.test(text)) {
    return {
      code: 'NOT_SERVICEABLE',
      detail: `Shadowfax pincode not serviceable: ${text}`,
      retryable: false,
    };
  }

  // Validation: contact number rejection ("Invalid contact").
  if (/invalid/i.test(text) && /contact/i.test(text)) {
    return {
      code: 'VALIDATION_FAILED',
      detail: `Shadowfax validation failed (contact): ${text}`,
      retryable: false,
    };
  }

  // Validation: required-field omission ("X is Required").
  if (/is\s+required/i.test(text)) {
    return {
      code: 'VALIDATION_FAILED',
      detail: `Shadowfax validation failed (missing field): ${text}`,
      retryable: false,
    };
  }

  // Auth surfaced as a 200/Failure envelope (yes, Shadowfax does this).
  if (/authentication/i.test(text)) {
    return {
      code: 'UNAUTHORIZED',
      detail: `Shadowfax authentication error: ${text}`,
      retryable: false,
    };
  }

  // Default: generic validation failure with raw text preserved.
  return {
    code: 'VALIDATION_FAILED',
    detail: text || 'Shadowfax returned message="Failure" with no error detail.',
    retryable: false,
  };
}

/**
 * Flatten Shadowfax's polymorphic `errors` field (string |
 * string[] | object-of-string-arrays) to a single space-separated
 * string for pattern matching.
 */
function flattenErrorText(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input
      .map((entry) => (typeof entry === 'string' ? entry : safeStringify(entry)))
      .join(' ');
  }
  if (typeof input === 'object') {
    // Could be { errors: '...' } at the failure-envelope level or a
    // field-error object like { contact: ['Invalid contact'] }.
    const obj = input as Record<string, unknown>;
    if (typeof obj.errors === 'string' || Array.isArray(obj.errors)) {
      return flattenErrorText(obj.errors);
    }
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
  // Shadowfax AWBs are alphanumeric, typically 10-20 chars. Pull the
  // first token that follows "AWB" or "awb_number" if present.
  const match = text.match(/AWB[\s:=]+([A-Z0-9]{8,20})/i);
  return match?.[1];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
