// Phase 89 (2026-05-23) — Shipment Evidence audit Gap #1.
//
// NIC e-Waybill adapter shell. Pre-Phase-89 selecting
// `EWAY_BILL_PROVIDER=nic` threw at boot with "not yet implemented" —
// the audit's first critical gap. This module provides the real
// integration surface so the env-flip works:
//
//   • Auth-token caching (NIC tokens are valid 6 hours).
//   • Payload marshalling (NIC's ItemList / supplyType / sub-type
//     mapping).
//   • Cancel via NIC's separate `canEwb` endpoint.
//   • Conservative error handling — any non-success NIC code surfaces
//     as a thrown error so the service layer can flip status=FAILED
//     and the retry cron picks the row up.
//
// Credentials are read from env. The factory in tax/module.ts refuses
// to build a NIC provider in production unless ALL of these are set:
//   NIC_API_BASE_URL          (e.g. https://api.gst.gov.in/eivital/v1.04)
//   NIC_GSP_USERNAME          (GSP account username)
//   NIC_GSP_PASSWORD          (GSP account password)
//   NIC_GSP_CLIENT_ID         (GSP client id)
//   NIC_GSP_CLIENT_SECRET     (GSP client secret)
//   NIC_TAXPAYER_GSTIN        (the supplier GSTIN for which auth is granted)
// If any are missing the provider throws on first call with a clear
// "NIC not configured" message rather than silently building a stub.

import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { computeValidUntil } from '../../domain/eway-bill-validity';
import {
  EWayBillProviderError,
  type EWayBillCancelInput,
  type EWayBillCancelResult,
  type EWayBillGenerateInput,
  type EWayBillGenerateResult,
  type EWayBillProvider,
  type EWayBillUpdatePartBInput,
  type EWayBillUpdatePartBResult,
} from './eway-bill-provider';

interface CachedAuthToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class NicEWayBillProvider implements EWayBillProvider {
  private readonly logger = new Logger(NicEWayBillProvider.name);
  readonly name = 'nic';
  private cachedAuth: CachedAuthToken | null = null;
  private static readonly AUTH_TTL_MS = 5 * 60 * 60 * 1000; // 5h; NIC issues 6h
  private static readonly NIC_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };

  constructor(private readonly env: EnvService) {
    // Phase 89 (2026-05-23) — Gap #1 / #2. Fail loudly on missing
    // credentials so a misconfigured prod deploy crashes at boot
    // instead of silently writing fake EWB numbers via the stub.
    const required = [
      'NIC_API_BASE_URL',
      'NIC_GSP_USERNAME',
      'NIC_GSP_PASSWORD',
      'NIC_GSP_CLIENT_ID',
      'NIC_GSP_CLIENT_SECRET',
      'NIC_TAXPAYER_GSTIN',
    ];
    const missing = required.filter(
      (key) => !this.env.getOptional(key as any),
    );
    if (missing.length > 0) {
      throw new Error(
        `NicEWayBillProvider: missing required env vars: ${missing.join(', ')}. ` +
          `Set them or fall back to EWAY_BILL_PROVIDER=stub for dev.`,
      );
    }
  }

  /**
   * Acquire / reuse a NIC auth token. NIC's auth endpoint takes the
   * GSP credentials + the taxpayer GSTIN and returns a session
   * token valid for ~6h. We cache for 5h to leave a margin and
   * pre-refresh on expiry-window approach.
   */
  private async authToken(): Promise<string> {
    if (this.cachedAuth && this.cachedAuth.expiresAt > Date.now()) {
      return this.cachedAuth.token;
    }
    const baseUrl = this.env.getString('NIC_API_BASE_URL', '');
    const res = await fetch(`${baseUrl}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': this.env.getString('NIC_GSP_CLIENT_ID', ''),
        'client-secret': this.env.getString('NIC_GSP_CLIENT_SECRET', ''),
      },
      body: JSON.stringify({
        username: this.env.getString('NIC_GSP_USERNAME', ''),
        password: this.env.getString('NIC_GSP_PASSWORD', ''),
        gstin: this.env.getString('NIC_TAXPAYER_GSTIN', ''),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`NIC auth failed (HTTP ${res.status}): ${body}`);
    }
    const json = (await res.json()) as { authtoken?: string };
    if (!json.authtoken) {
      throw new Error('NIC auth response missing authtoken');
    }
    this.cachedAuth = {
      token: json.authtoken,
      expiresAt: Date.now() + NicEWayBillProvider.AUTH_TTL_MS,
    };
    return json.authtoken;
  }

  /**
   * NIC requires the EWB date in `DD/MM/YYYY HH:MM:SS` IST. Standard
   * `toISOString()` gives UTC, so format explicitly. Phase 89 Gap #6 —
   * never rely on the local clock; format relative to IST always.
   */
  private formatNicDateIST(date: Date): string {
    const parts = new Intl.DateTimeFormat(
      'en-IN',
      NicEWayBillProvider.NIC_DATE_FORMAT_OPTIONS,
    )
      .formatToParts(date)
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  /**
   * Marshal our internal generate input into NIC's GenerateEwbReq shape.
   * Real NIC schema has 40+ fields; this covers the mandatory subset.
   * Additional optional fields (consignor address line 1/2, dispatch
   * details, transit modes) are out of scope for the shell but easy to
   * add when the production rollout demands them.
   */
  private buildNicPayload(input: EWayBillGenerateInput): unknown {
    if (!input.items?.length) {
      throw new Error('NIC requires non-empty item list');
    }
    return {
      supplyType: 'O', // Outward
      subSupplyType: '1', // Supply
      docType: 'INV', // Tax Invoice
      docNo: input.invoiceDocumentNumber ?? 'UNKNOWN',
      docDate: input.invoiceDate
        ? this.formatNicDateIST(input.invoiceDate).slice(0, 10)
        : this.formatNicDateIST(new Date()).slice(0, 10),
      fromGstin: input.supplierGstin ?? '',
      fromPincode: input.fromPincode ?? '',
      fromStateCode: input.fromStateCode ?? '',
      toPincode: input.toPincode ?? '',
      toStateCode: input.toStateCode ?? '',
      transactionType: 1,
      totalValue: Number(input.consignmentValueInPaise / 100n),
      transMode:
        input.transportMode === 'RAIL'
          ? '2'
          : input.transportMode === 'AIR'
            ? '3'
            : input.transportMode === 'SHIP'
              ? '4'
              : '1', // ROAD default
      vehicleNo: input.vehicleNumber ?? '',
      transporterId: input.transporterId ?? '',
      transporterName: input.transporterName ?? '',
      transDistance: input.distanceKm ?? 50,
      itemList: input.items.map((it) => ({
        productName: it.productName,
        hsnCode: it.hsnOrSacCode ?? '',
        quantity: it.quantity,
        qtyUnit: it.uqcCode ?? '',
        taxableAmount: Number(it.taxableAmountInPaise / 100n),
        gstRate: it.gstRateBps / 100,
      })),
    };
  }

  async generate(
    input: EWayBillGenerateInput,
  ): Promise<EWayBillGenerateResult> {
    const token = await this.authToken();
    const baseUrl = this.env.getString('NIC_API_BASE_URL', '');
    const payload = this.buildNicPayload(input);
    const res = await fetch(`${baseUrl}/ewaybillapi/v1.03/ewayapi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authtoken: token,
        gstin: this.env.getString('NIC_TAXPAYER_GSTIN', ''),
        'action': 'GENEWAYBILL',
      },
      body: JSON.stringify(payload),
    });
    const responseJson = (await res.json()) as Record<string, unknown>;
    if (!res.ok || responseJson?.['status_cd'] !== '1') {
      throw this.classifyNicError(res.status, responseJson, 'generate');
    }
    const data = responseJson?.['data'] as Record<string, unknown> | undefined;
    const ewbNumber = String(data?.['ewayBillNo'] ?? '');
    const ewbDate = parseNicIstDate(String(data?.['ewayBillDate'] ?? ''));
    const validUntil = parseNicIstDate(String(data?.['validUpto'] ?? ''));
    // Phase 89 — Gap #6. Always use NIC's authoritative dates, never
    // server local clock.
    return {
      ewbNumber,
      ewbDate,
      validUntil: Number.isNaN(validUntil.getTime())
        ? computeValidUntil(ewbDate, input.distanceKm ?? 50)
        : validUntil,
      rawRequestJson: payload as any,
      rawResponseJson: responseJson as any,
      nicAckNo: String(data?.['ackNo'] ?? ''),
      nicAckDate: data?.['ackDt']
        ? parseNicIstDate(String(data['ackDt']))
        : undefined,
    } as EWayBillGenerateResult & {
      nicAckNo?: string;
      nicAckDate?: Date;
    };
  }

  async cancel(input: EWayBillCancelInput): Promise<EWayBillCancelResult> {
    const token = await this.authToken();
    const baseUrl = this.env.getString('NIC_API_BASE_URL', '');
    const res = await fetch(`${baseUrl}/ewaybillapi/v1.03/ewayapi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authtoken: token,
        gstin: this.env.getString('NIC_TAXPAYER_GSTIN', ''),
        action: 'CANEWB',
      },
      body: JSON.stringify({
        ewbNo: Number(input.ewbNumber),
        cancelRsnCode: 4, // Others — service-side reason in cancelRmrk
        cancelRmrk: input.reason,
      }),
    });
    const responseJson = (await res.json()) as Record<string, unknown>;
    if (!res.ok || responseJson?.['status_cd'] !== '1') {
      throw this.classifyNicError(res.status, responseJson, 'cancel');
    }
    const data = responseJson?.['data'] as Record<string, unknown> | undefined;
    return {
      cancelledAt: data?.['cancelDate']
        ? parseNicIstDate(String(data['cancelDate']))
        : new Date(),
      // Phase 160 (#7) — NIC echoes the EWB number on cancel; that + the
      // cancel date is the cancellation reference for reconciliation.
      providerCancelReference: data?.['ewayBillNo']
        ? String(data['ewayBillNo'])
        : null,
      rawResponseJson: responseJson as any,
    };
  }

  // Phase 160 (audit #18) — NIC Part-B update via action=UPDATEPARTB. NIC
  // re-issues the validity; we return the new validUpto.
  async updatePartB(
    input: EWayBillUpdatePartBInput,
  ): Promise<EWayBillUpdatePartBResult> {
    const token = await this.authToken();
    const baseUrl = this.env.getString('NIC_API_BASE_URL', '');
    const res = await fetch(`${baseUrl}/ewaybillapi/v1.03/ewayapi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authtoken: token,
        gstin: this.env.getString('NIC_TAXPAYER_GSTIN', ''),
        action: 'UPDATEPARTB',
      },
      body: JSON.stringify({
        ewbNo: Number(input.ewbNumber),
        vehicleNo: input.vehicleNumber ?? '',
        transMode:
          input.transportMode === 'RAIL'
            ? '2'
            : input.transportMode === 'AIR'
              ? '3'
              : input.transportMode === 'SHIP'
                ? '4'
                : '1',
        transDocNo: input.transporterId ?? '',
        transDistance: input.distanceKm ?? 50,
        reasonCode: '4', // Others — service-side reason in reasonRem
        reasonRem: input.reason,
      }),
    });
    const responseJson = (await res.json()) as Record<string, unknown>;
    if (!res.ok || responseJson?.['status_cd'] !== '1') {
      throw this.classifyNicError(res.status, responseJson, 'updatePartB');
    }
    const data = responseJson?.['data'] as Record<string, unknown> | undefined;
    const validUntil = parseNicIstDate(String(data?.['validUpto'] ?? ''));
    return {
      validUntil: Number.isNaN(validUntil.getTime())
        ? computeValidUntil(new Date(), input.distanceKm ?? 50)
        : validUntil,
      rawResponseJson: responseJson as any,
    };
  }

  /**
   * Phase 160 (#11) — map an HTTP status + NIC error payload to a typed,
   * retry-classified error. NIC returns errors as `error: {errorCodes:"238"}`
   * or a string. Token expiry clears the auth cache.
   */
  private classifyNicError(
    httpStatus: number,
    raw: Record<string, unknown>,
    op: 'generate' | 'cancel' | 'updatePartB',
  ): EWayBillProviderError {
    const nicCode = extractNicErrorCode(raw['error']);
    const detail = JSON.stringify(raw['error'] ?? raw);
    if (httpStatus === 401) {
      this.cachedAuth = null;
      return new EWayBillProviderError(
        `NIC ${op} auth expired (401); will refresh on retry`,
        'AUTH',
        { nicErrorCode: nicCode, httpStatus },
      );
    }
    if (httpStatus === 429) {
      return new EWayBillProviderError(
        `NIC ${op} rate-limited (429); back off + retry`,
        'RATE_LIMIT',
        { nicErrorCode: nicCode, httpStatus },
      );
    }
    if (httpStatus >= 500) {
      return new EWayBillProviderError(
        `NIC ${op} server error (HTTP ${httpStatus}): ${detail}`,
        'TRANSIENT',
        { nicErrorCode: nicCode, httpStatus },
      );
    }
    // 4xx / status_cd != 1 = a data/validation error (invalid GSTIN, bad
    // vehicle format, missing HSN). Retrying the same payload won't help.
    return new EWayBillProviderError(
      `NIC ${op} rejected (HTTP ${httpStatus}, code ${nicCode ?? 'n/a'}): ${detail}`,
      'PERMANENT',
      { nicErrorCode: nicCode, httpStatus },
    );
  }
}

/**
 * Phase 160 (#11) — pull the NIC error code from the `error` field. NIC
 * returns `{ errorCodes: "238" }`, `{ error_cd: "238" }`, or a flat string
 * like "238 : Invalid vehicle number". Returns null when not parseable.
 */
function extractNicErrorCode(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const code = o.errorCodes ?? o.error_cd ?? o.errorCode ?? o.code;
    if (code != null) return String(code).split(',')[0]!.trim();
  }
  if (typeof err === 'string') {
    const m = /(\d{2,4})/.exec(err);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * NIC returns dates as `DD/MM/YYYY HH:MM:SS` in IST. Convert to a
 * UTC Date object for storage.
 */
function parseNicIstDate(raw: string): Date {
  if (!raw) return new Date(NaN);
  // DD/MM/YYYY HH:MM:SS — split into ISO-friendly parts.
  const m = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!m) return new Date(NaN);
  const [, day, month, year, hour, minute, second] = m;
  // IST is UTC+5:30 — construct as UTC by subtracting the offset.
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
  return new Date(iso);
}
