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
  | 'shipping_sac_code'
  | 'shipping_gst_rate_bps'
  | 'shipping_tax_inclusive'
  | 'goodwill_approval_threshold_paise'
  | 'tcs_rate_bps'
  | 'default_gst_rate_bps_test_mode'
  | 'tax_strict_mode'
  | 'tax_audit_mode'
  | 'invoice_generation_enabled'
  | 'credit_note_generation_enabled'
  | 'eway_bill_enabled'
  | 'gst_tcs_enabled'
  | 'gstr8_enabled'
  | 'einvoice_enabled'
  | 'legacy_order_cutoff_date'
  | 'b2b_place_of_supply_source'
  | 'section_34_window_cutoff_month';

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
}
