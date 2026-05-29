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
import type {
  EInvoiceProvider,
  IrnCancelInput,
  IrnCancelResult,
  IrnGenerateInput,
  IrnGenerateResult,
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
    // Phase 90 — Gap #26 error classification.
    if (res.status === 401) {
      // Token expired — clear cache and bubble so retry cron picks up.
      this.cachedAuth = null;
      throw new Error(`NIC IRP auth expired (401); will refresh on retry`);
    }
    if (res.status === 429) {
      throw new Error(`NIC IRP rate-limited (429); back off + retry`);
    }
    if (!res.ok || (responseJson as any)?.Status !== 1) {
      const errDetail = (responseJson as any)?.ErrorDetails ?? responseJson;
      throw new Error(
        `NIC IRP generate failed (HTTP ${res.status}): ${JSON.stringify(errDetail)}`,
      );
    }
    const data = (responseJson as any)?.Data ?? {};
    if (!data.Irn) {
      throw new Error('NIC IRP response missing IRN field');
    }
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
    if (res.status === 401) {
      this.cachedAuth = null;
      throw new Error('NIC IRP auth expired (401); will refresh on retry');
    }
    if (!res.ok || (responseJson as any)?.Status !== 1) {
      const errDetail = (responseJson as any)?.ErrorDetails ?? responseJson;
      throw new Error(
        `NIC IRP cancel failed (HTTP ${res.status}): ${JSON.stringify(errDetail)}`,
      );
    }
    return {
      cancelledAt: new Date(),
      signedDocumentJson: responseJson,
    };
  }
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
