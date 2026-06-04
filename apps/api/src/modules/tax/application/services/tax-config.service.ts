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
  | 'commission_gst_rate_bps';

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
