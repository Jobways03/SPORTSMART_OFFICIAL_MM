// Phase 90 (2026-05-23) — Shipment Evidence audit Gap #2.
//
// NIC IRP (Invoice Registration Portal) adapter shell. Pre-Phase-90
// selecting `EINVOICE_PROVIDER=nic` threw at boot — the audit's
// second critical gap. This module provides:
//
//   • Auth token caching (Redis-style 5h TTL; NIC issues 6h)
//   • Payload marshalling to NIC's `eivital/v1.04/Invoice` schema
//   • Cancel via `/Invoice/Cancel`
//   • Error classification: 401 → refresh token; 429 → backoff;
//     400 → permanent (do not retry); 5xx → retry
//
// Credentials must be set as env vars; the constructor throws with
// a clear "missing var" message when any is absent. The factory in
// `tax/module.ts` refuses to build NIC in production unless all are
// present (Phase 90 Gap #3 stub-in-prod guard pairs with this).

import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  EInvoiceProviderError,
  type EInvoiceProvider,
  type IrnCancelInput,
  type IrnCancelResult,
  type IrnGenerateInput,
  type IrnGenerateResult,
} from './einvoice-provider';

interface CachedAuthToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class NicEInvoiceProvider implements EInvoiceProvider {
  private readonly logger = new Logger(NicEInvoiceProvider.name);
  readonly name = 'nic';
  private cachedAuth: CachedAuthToken | null = null;
  private static readonly AUTH_TTL_MS = 5 * 60 * 60 * 1000;

  constructor(private readonly env: EnvService) {
    const required = [
      'NIC_IRP_BASE_URL',
      'NIC_IRP_GSP_USERNAME',
      'NIC_IRP_GSP_PASSWORD',
      'NIC_IRP_GSP_CLIENT_ID',
      'NIC_IRP_GSP_CLIENT_SECRET',
      'NIC_IRP_TAXPAYER_GSTIN',
    ];
    const missing = required.filter(
      (k) => !this.env.getOptional(k as any),
    );
    if (missing.length > 0) {
      throw new Error(
        `NicEInvoiceProvider: missing required env vars: ${missing.join(', ')}. ` +
          `Set them or use EINVOICE_PROVIDER=stub for dev.`,
      );
    }
  }

  private async authToken(): Promise<string> {
    if (this.cachedAuth && this.cachedAuth.expiresAt > Date.now()) {
      return this.cachedAuth.token;
    }
    const baseUrl = this.env.getString('NIC_IRP_BASE_URL', '');
    const res = await fetch(`${baseUrl}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': this.env.getString('NIC_IRP_GSP_CLIENT_ID', ''),
        'client-secret': this.env.getString('NIC_IRP_GSP_CLIENT_SECRET', ''),
      },
      body: JSON.stringify({
        username: this.env.getString('NIC_IRP_GSP_USERNAME', ''),
        password: this.env.getString('NIC_IRP_GSP_PASSWORD', ''),
        gstin: this.env.getString('NIC_IRP_TAXPAYER_GSTIN', ''),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NIC IRP auth failed (HTTP ${res.status}): ${body}`);
    }
    const json = (await res.json()) as { authtoken?: string };
    if (!json.authtoken) {
      throw new Error('NIC IRP auth response missing authtoken');
    }
    this.cachedAuth = {
      token: json.authtoken,
      expiresAt: Date.now() + NicEInvoiceProvider.AUTH_TTL_MS,
    };
    return json.authtoken;
  }

  /**
   * Build NIC's e-invoice payload from our internal input. Real NIC
   * schema has 50+ fields; this covers the mandatory subset + the
   * Phase 90 additions (transactionCategory, originalIrn, reverseCharge).
   */
  private buildNicPayload(input: IrnGenerateInput): unknown {
    if (!input.lineItems?.length) {
      throw new Error('NIC IRP requires non-empty itemList');
    }
    const docDateIst = formatDateIst(input.documentDate);
    const txTypeMap: Record<string, number> = {
      B2B: 1,
      SEZWP: 4,
      SEZWOP: 5,
      EXPWP: 6,
      EXPWOP: 7,
      DEXP: 8,
    };
    return {
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: input.transactionCategory,
        RegRev: input.reverseChargeApplicable ? 'Y' : 'N',
      },
      DocDtls: {
        Typ:
          input.documentType === 'CREDIT_NOTE'
            ? 'CRN'
            : input.documentType === 'DEBIT_NOTE'
              ? 'DBN'
              : 'INV',
        No: input.documentNumber,
        Dt: docDateIst,
      },
      SellerDtls: {
        Gstin: input.supplierGstin,
      },
      BuyerDtls: {
        Gstin: input.buyerGstin,
        Pos: input.placeOfSupplyStateCode ?? input.buyerGstin.slice(0, 2),
      },
      PrecDocDtls:
        input.originalIrn && input.originalDocumentNumber
          ? [
              {
                InvNo: input.originalDocumentNumber,
                InvDt: input.originalDocumentDate
                  ? formatDateIst(input.originalDocumentDate)
                  : docDateIst,
                OthRefNo: input.originalIrn,
              },
            ]
          : undefined,
      ItemList: input.lineItems.map((it, idx) => ({
        SlNo: String(idx + 1),
        PrdDesc: it.productName,
        HsnCd: it.hsnOrSacCode ?? '',
        Qty: it.quantity,
        Unit: it.uqcCode ?? 'NOS',
        UnitPrice: Number(it.unitPriceInPaise) / 100,
        TotAmt: Number(it.taxableInPaise) / 100,
        AssAmt: Number(it.taxableInPaise) / 100,
        GstRt: it.gstRateBps / 100,
        TxTyp: txTypeMap[input.transactionCategory] ?? 1,
      })),
      ValDtls: {
        AssVal: Number(input.taxableValueInPaise) / 100,
        CgstVal: Number(input.cgstInPaise) / 100,
        SgstVal: Number(input.sgstInPaise) / 100,
        IgstVal: Number(input.igstInPaise) / 100,
        CesVal: Number(input.cessInPaise) / 100,
        TotInvVal: Number(input.totalInvoiceValueInPaise) / 100,
      },
    };
  }

  async generate(input: IrnGenerateInput): Promise<IrnGenerateResult> {
    const token = await this.authToken();
    const baseUrl = this.env.getString('NIC_IRP_BASE_URL', '');
    const payload = this.buildNicPayload(input);
    const res = await fetch(`${baseUrl}/eivital/v1.04/Invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authtoken: token,
        gstin: this.env.getString('NIC_IRP_TAXPAYER_GSTIN', ''),
      },
      body: JSON.stringify(payload),
    });
    const responseJson = (await res.json()) as Record<string, unknown>;
    const data = (responseJson as any)?.Data ?? {};
    const status = (responseJson as any)?.Status;

    // Success.
    if (res.ok && status === 1 && data.Irn) {
      return {
        irn: String(data.Irn),
        ackNo: String(data.AckNo ?? ''),
        ackDate: data.AckDt ? parseIstDate(String(data.AckDt)) : new Date(),
        signedDocumentJson: responseJson,
        qrCodeUrl:
          typeof data.SignedQRCode === 'string' && data.SignedQRCode.length > 0
            ? `data:image/png;base64,${data.SignedQRCode}`
            : '',
      };
    }

    // Phase 160 (#8) — typed error classification by NIC business code.
    const nicErrors = parseNicErrors(responseJson);
    const dup = nicErrors.find((e) => e.code === '2150');
    if (dup) {
      // 2150 = invoice already registered. NIC returns the existing IRN in
      // the duplicate payload — recover it so a retry is IDEMPOTENT (the
      // audit's expected behaviour) instead of failing.
      const existingIrn = extractDuplicateIrn(responseJson);
      if (existingIrn) {
        return {
          irn: existingIrn.irn,
          ackNo: existingIrn.ackNo,
          ackDate: existingIrn.ackDate,
          signedDocumentJson: responseJson,
          qrCodeUrl: existingIrn.qrCodeUrl,
        };
      }
      throw new EInvoiceProviderError(
        `NIC IRP: invoice already registered (2150): ${dup.message}`,
        'DUPLICATE',
        { nicErrorCode: '2150', httpStatus: res.status },
      );
    }
    throw this.classifyNicError(res.status, nicErrors, responseJson);
  }

  /**
   * Phase 160 (#8) — map an HTTP status + NIC error codes to a typed,
   * retry-classified error. Token-expiry clears the auth cache.
   */
  private classifyNicError(
    httpStatus: number,
    nicErrors: { code: string; message: string }[],
    raw: unknown,
  ): EInvoiceProviderError {
    const code = nicErrors[0]?.code ?? null;
    const detail =
      nicErrors.length > 0
        ? nicErrors.map((e) => `${e.code}:${e.message}`).join('; ')
        : JSON.stringify((raw as any)?.ErrorDetails ?? raw);
    // Token expired (HTTP 401 or NIC 2172) → refresh on next call.
    if (httpStatus === 401 || code === '2172') {
      this.cachedAuth = null;
      return new EInvoiceProviderError(
        `NIC IRP auth expired (${code ?? httpStatus}); will refresh on retry`,
        'AUTH',
        { nicErrorCode: code, httpStatus },
      );
    }
    if (httpStatus === 429) {
      return new EInvoiceProviderError(
        'NIC IRP rate-limited (429); back off + retry',
        'RATE_LIMIT',
        { nicErrorCode: code, httpStatus },
      );
    }
    if (httpStatus >= 500) {
      return new EInvoiceProviderError(
        `NIC IRP server error (HTTP ${httpStatus}): ${detail}`,
        'TRANSIENT',
        { nicErrorCode: code, httpStatus },
      );
    }
    // 4xx / Status≠1 with a business error code = permanent (bad payload,
    // e.g. 2253 mandatory field missing). Retrying won't help.
    return new EInvoiceProviderError(
      `NIC IRP generate rejected (HTTP ${httpStatus}): ${detail}`,
      'PERMANENT',
      { nicErrorCode: code, httpStatus },
    );
  }

  async cancel(input: IrnCancelInput): Promise<IrnCancelResult> {
    const token = await this.authToken();
    const baseUrl = this.env.getString('NIC_IRP_BASE_URL', '');
    const res = await fetch(`${baseUrl}/eivital/v1.04/Invoice/Cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authtoken: token,
        gstin: this.env.getString('NIC_IRP_TAXPAYER_GSTIN', ''),
      },
      body: JSON.stringify({
        Irn: input.irn,
        CnlRsn: input.cancellationCode,
        CnlRem: input.cancellationReason,
      }),
    });
    const responseJson = (await res.json()) as Record<string, unknown>;
    if (res.ok && (responseJson as any)?.Status === 1) {
      return { cancelledAt: new Date(), signedDocumentJson: responseJson };
    }
    // Phase 160 (#8) — typed error classification (mirrors generate()).
    throw this.classifyNicError(res.status, parseNicErrors(responseJson), responseJson);
  }
}

/**
 * Phase 160 (#8) — pull NIC's error codes out of the response. NIC returns
 * errors either as `ErrorDetails: [{ErrorCode, ErrorMessage}, ...]` or a
 * pipe-joined `error.message` string ("2150 : Duplicate IRN | ...").
 */
function parseNicErrors(raw: unknown): { code: string; message: string }[] {
  const r = raw as any;
  const out: { code: string; message: string }[] = [];
  const details = r?.ErrorDetails;
  if (Array.isArray(details)) {
    for (const d of details) {
      const code = String(d?.ErrorCode ?? d?.errorCode ?? '').trim();
      if (code) out.push({ code, message: String(d?.ErrorMessage ?? d?.errorMessage ?? '') });
    }
  }
  // Fallback: a flat error string like "2150 : already registered".
  const flat = typeof r?.error?.message === 'string' ? r.error.message : null;
  if (out.length === 0 && flat) {
    for (const part of flat.split('|')) {
      const m = /^\s*(\d{3,4})\s*[:\-]\s*(.*)$/.exec(part);
      if (m) out.push({ code: m[1]!, message: m[2]!.trim() });
    }
  }
  return out;
}

/**
 * Phase 160 (#8) — NIC's 2150 (duplicate) response carries the
 * already-registered IRN so a retry can be idempotent. Extract it from the
 * known locations; return null when NIC didn't include it (caller throws
 * DUPLICATE then).
 */
function extractDuplicateIrn(
  raw: unknown,
): { irn: string; ackNo: string; ackDate: Date; qrCodeUrl: string } | null {
  const r = raw as any;
  // NIC variants: Data.Irn (rare), or Desc/InfoDtls carrying the Irn.
  const irn =
    (typeof r?.Data?.Irn === 'string' && r.Data.Irn) ||
    (typeof r?.Desc?.Irn === 'string' && r.Desc.Irn) ||
    (Array.isArray(r?.InfoDtls) &&
      r.InfoDtls.find((i: any) => typeof i?.Desc?.Irn === 'string')?.Desc?.Irn) ||
    null;
  if (!irn) return null;
  const src = r?.Data ?? r?.Desc ?? {};
  return {
    irn: String(irn),
    ackNo: String(src.AckNo ?? ''),
    ackDate: src.AckDt ? parseIstDate(String(src.AckDt)) : new Date(),
    qrCodeUrl:
      typeof src.SignedQRCode === 'string' && src.SignedQRCode.length > 0
        ? `data:image/png;base64,${src.SignedQRCode}`
        : '',
  };
}

/** NIC expects dates as `dd/mm/yyyy` IST. */
function formatDateIst(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.day}/${parts.month}/${parts.year}`;
}

function parseIstDate(raw: string): Date {
  // NIC returns ack dates as `YYYY-MM-DD HH:MM:SS` in IST.
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (m) {
    const [, year, month, day, hour, minute, second] = m;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
  }
  return new Date(raw);
}
