// Phase 2 — TaxConfigService.
//
// Reads runtime tax configuration from `tax_config` table. Cached in
// memory with 60s TTL to avoid hot-path DB hits. Admin UI cache-busts
// via TaxConfigService.invalidate() after edits.
//
// All keys are typed via TaxConfigKey enum; type-narrowing is the
// caller's responsibility. Use this service for any setting an admin
// can change at runtime; use env vars only for boot-time-fixed settings.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  DEFAULT_SETTLEMENT_TAX_CONFIG,
  isSettlementTaxBaseType,
  type SettlementTaxBaseType,
  type SettlementTaxConfig,
} from '../../domain/settlement-tax-config';

/**
 * Known config keys with their value type. Keep this union exhaustive
 * — any caller asking for an unknown key should get a TS error.
 */
export type TaxConfigKey =
  | 'required_hsn_length'
  | 'eway_bill_threshold_paise'
  | 'eway_bill_intra_state_distance_threshold_km'
  // Phase 89 (2026-05-23) — Gap #18 per-state threshold override.
  // JSON map keyed on GST state code, e.g.:
  //   { "27": 1_00_00_00, "33": 1_00_00_00, "07": 1_00_00_00 }
  // Applies only to intra-state movements; inter-state always uses
  // the national `eway_bill_threshold_paise`.
  | 'eway_bill_threshold_paise_by_state'
  // Phase 89 — Gap #19 retention. Default 3 years post-issuance
  // matches CBIC's record-retention requirement.
  | 'eway_bill_raw_payload_retention_days'
  // Phase 89 — Gap #10 retry policy.
  | 'eway_bill_max_retries'
  | 'eway_bill_retry_backoff_minutes'
  | 'shipping_sac_code'
  | 'shipping_gst_rate_bps'
  | 'shipping_tax_inclusive'
  | 'goodwill_approval_threshold_paise'
  | 'tcs_rate_bps'
  | 'default_gst_rate_bps_test_mode'
  | 'tax_strict_mode'
  | 'tax_audit_mode'
  // Phase 159w (GST Mode Toggle audit #7) — authoritative single mode key
  // ('OFF' | 'AUDIT' | 'STRICT'). The two boolean flags above are kept in sync
  // for back-compat readers (place-of-supply, env fallback) but this key is the
  // source of truth, eliminating the two-row partial-update race.
  | 'tax_mode'
  | 'invoice_generation_enabled'
  | 'credit_note_generation_enabled'
  | 'eway_bill_enabled'
  | 'gst_tcs_enabled'
  | 'gstr8_enabled'
  | 'einvoice_enabled'
  | 'legacy_order_cutoff_date'
  | 'b2b_place_of_supply_source'
  | 'section_34_window_cutoff_month'
  // Phase 159aa (Marketplace Commission GSTR-1 audit #17) — SAC + rate
  // for the marketplace's own commission supply (SAC 9985 / 18% today).
  // Snapshotted onto SellerSettlement at commission-invoice issue time.
  | 'commission_sac_code'
  | 'commission_gst_rate_bps'
  // Phase 252 — settlement tax BASE config ('what each tax is levied on':
  // 'COMMISSION' | 'PRICE_OF_GOODS_SOLD'). The rate keys already exist
  // (tcs_rate_bps / commission_gst_rate_bps); tds_rate_bps is added so the
  // §194-O rate is admin-tunable too. Read by the statutory engine so a CA /
  // regulatory change (e.g. "TDS on commission, not product") is a config edit
  // that flows to BOTH the payout AND the GSTR-8 / Form-26Q filings.
  | 'commission_gst_base_type'
  | 'tcs_base_type'
  | 'tds_rate_bps'
  | 'tds_base_type'
  // Master on/off switch per settlement tax. Missing key => true (on), so
  // existing installs keep all three taxes active until explicitly turned off.
  | 'commission_gst_enabled'
  | 'tcs_enabled'
  | 'tds_enabled';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

@Injectable()
export class TaxConfigService {
  private readonly logger = new Logger(TaxConfigService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async get<T = unknown>(key: TaxConfigKey, fallback?: T): Promise<T | undefined> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    const row = await this.prisma.taxConfig.findUnique({ where: { key } });
    if (!row) {
      if (fallback !== undefined) return fallback;
      this.logger.warn(`tax_config key "${key}" not found and no fallback provided`);
      return undefined;
    }
    this.cache.set(key, { value: row.value, expiresAt: Date.now() + CACHE_TTL_MS });
    return row.value as T;
  }

  async getNumber(key: TaxConfigKey, fallback: number): Promise<number> {
    const v = await this.get<number | string>(key, fallback);
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
    return fallback;
  }

  async getBoolean(key: TaxConfigKey, fallback: boolean): Promise<boolean> {
    const v = await this.get<boolean | string>(key, fallback);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    return fallback;
  }

  async getString(key: TaxConfigKey, fallback: string): Promise<string> {
    const v = await this.get<string>(key, fallback);
    return typeof v === 'string' ? v : fallback;
  }

  /** Bust cache for a specific key (or all keys when called without arg). */
  invalidate(key?: TaxConfigKey): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  // ── Phase 37 — admin CRUD ────────────────────────────────────
  //
  // Used by AdminTaxConfigController so day-2 ops can tune knobs
  // without a DB migration. Upserts the row and busts the cache so
  // the new value is picked up on the next read.

  async listAll(): Promise<TaxConfigRow[]> {
    const rows = await this.prisma.taxConfig.findMany({
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      value: r.value as unknown,
      description: r.description ?? null,
      updatedBy: r.updatedBy ?? null,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async setAdmin(input: {
    key: string;
    value: unknown;
    description?: string | null;
    actor: string;
  }): Promise<TaxConfigRow> {
    if (!input.key || input.key.length > 100) {
      throw new Error('key must be 1-100 chars');
    }
    const row = await this.prisma.taxConfig.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        value: input.value as any,
        description: input.description ?? null,
        updatedBy: input.actor,
      },
      update: {
        value: input.value as any,
        description: input.description ?? undefined,
        updatedBy: input.actor,
      },
    });
    this.invalidate(input.key as TaxConfigKey);
    return {
      id: row.id,
      key: row.key,
      value: row.value as unknown,
      description: row.description ?? null,
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ── Phase 252 — settlement tax config (rate + base for GST / TCS / TDS) ──
  //
  // The single source the statutory engine reads. TCS base stays statutory
  // (taxable value of supplies, §52) and is not a commission/product knob —
  // only its rate is tunable. GST and TDS expose both rate and base.

  async getSettlementTaxConfig(): Promise<SettlementTaxConfig> {
    const d = DEFAULT_SETTLEMENT_TAX_CONFIG;
    const baseOf = async (
      key: 'commission_gst_base_type' | 'tcs_base_type' | 'tds_base_type',
      fallback: SettlementTaxBaseType,
    ): Promise<SettlementTaxBaseType> => {
      const v = await this.getString(key, fallback);
      return isSettlementTaxBaseType(v) ? v : fallback;
    };
    // enabled flags default to true (missing key => on). The saved rate is
    // returned as-is even when disabled, so the editor still shows it and the
    // toggle is a pure on/off — the calc paths (commission-GST at settlement
    // creation, TCS / TDS hooks) check `enabled` and skip when it's false.
    return {
      gst: {
        rateBps: await this.getNumber('commission_gst_rate_bps', d.gst.rateBps),
        baseType: await baseOf('commission_gst_base_type', d.gst.baseType),
        enabled: await this.getBoolean('commission_gst_enabled', true),
      },
      tcs: {
        rateBps: await this.getNumber('tcs_rate_bps', d.tcs.rateBps),
        baseType: await baseOf('tcs_base_type', d.tcs.baseType),
        enabled: await this.getBoolean('tcs_enabled', true),
      },
      tds: {
        rateBps: await this.getNumber('tds_rate_bps', d.tds.rateBps),
        baseType: await baseOf('tds_base_type', d.tds.baseType),
        enabled: await this.getBoolean('tds_enabled', true),
      },
    };
  }

  /** Editor write path — validates rate ≥ 0 and base ∈ allowed set per tax. */
  async setSettlementTaxConfig(
    input: {
      gst?: { rateBps?: number; baseType?: string; enabled?: boolean };
      tcs?: { rateBps?: number; baseType?: string; enabled?: boolean };
      tds?: { rateBps?: number; baseType?: string; enabled?: boolean };
    },
    actor: string,
  ): Promise<SettlementTaxConfig> {
    const rate = (v: number | undefined, label: string): number => {
      if (v === undefined) return v as unknown as number;
      if (!Number.isInteger(v) || v < 0 || v > 10_000) {
        throw new Error(`${label} rate must be a whole number 0-10000 basis points`);
      }
      return v;
    };
    const base = (v: string | undefined, label: string): string | undefined => {
      if (v === undefined) return undefined;
      if (!isSettlementTaxBaseType(v)) {
        throw new Error(`${label} base must be COMMISSION or PRICE_OF_GOODS_SOLD`);
      }
      return v;
    };
    const writes: Array<{ key: string; value: unknown }> = [];
    if (input.gst?.rateBps !== undefined)
      writes.push({ key: 'commission_gst_rate_bps', value: rate(input.gst.rateBps, 'GST') });
    if (input.gst?.baseType !== undefined)
      writes.push({ key: 'commission_gst_base_type', value: base(input.gst.baseType, 'GST') });
    if (input.tcs?.rateBps !== undefined)
      writes.push({ key: 'tcs_rate_bps', value: rate(input.tcs.rateBps, 'TCS') });
    if (input.tcs?.baseType !== undefined)
      writes.push({ key: 'tcs_base_type', value: base(input.tcs.baseType, 'TCS') });
    if (input.tds?.rateBps !== undefined)
      writes.push({ key: 'tds_rate_bps', value: rate(input.tds.rateBps, 'TDS') });
    if (input.tds?.baseType !== undefined)
      writes.push({ key: 'tds_base_type', value: base(input.tds.baseType, 'TDS') });
    // Master on/off per tax — stored as a boolean; missing key reads back as on.
    if (input.gst?.enabled !== undefined)
      writes.push({ key: 'commission_gst_enabled', value: !!input.gst.enabled });
    if (input.tcs?.enabled !== undefined)
      writes.push({ key: 'tcs_enabled', value: !!input.tcs.enabled });
    if (input.tds?.enabled !== undefined)
      writes.push({ key: 'tds_enabled', value: !!input.tds.enabled });

    for (const w of writes) {
      await this.setAdmin({ key: w.key, value: w.value, actor });
    }
    return this.getSettlementTaxConfig();
  }
}

// Phase 37 — admin DTO shape; values are arbitrary JSON.
export interface TaxConfigRow {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}
