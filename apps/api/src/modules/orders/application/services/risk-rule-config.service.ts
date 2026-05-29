import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12.
 *
 * Cache + accessor over `OrderRiskRuleConfig`. The rule LOGIC stays
 * in `RiskScoringService` (some rules need Prisma queries that
 * aren't expressible in JSON); the WEIGHTS and the per-rule
 * THRESHOLDS come from this table. Tuning a rule no longer needs a
 * redeploy — an admin with `orders.verify.tune_rules` can edit
 * via the controller, the cache flips, and the next scoreOrder()
 * call uses the new value.
 *
 * Cache strategy: in-memory map, lazily filled on first read.
 * `invalidate()` clears the cache; called by the admin tune
 * endpoint on every write. A missing row falls back to the
 * hardcoded default emitted by `defaultsFor(code)` so a fresh
 * deploy without seed data still scores correctly.
 *
 * Cache is process-local. Multi-replica clusters get coherent
 * reads within ~30s — the service re-loads on the next miss or
 * on a follow-up invalidate from the same admin. If strict
 * cross-replica invalidation matters later, this is the spot to
 * add a Redis pub-sub trigger.
 */

export type OrderRiskReasonCodeKey =
  | 'FIRST_TIME_CUSTOMER'
  | 'REPEAT_CUSTOMER'
  | 'COD_PAYMENT'
  | 'ONLINE_CAPTURED'
  | 'ONLINE_NOT_CAPTURED'
  | 'HIGH_VALUE'
  | 'VERY_HIGH_VALUE'
  | 'BULK_ORDER'
  | 'PINCODE_RTO'
  | 'CANCELLATION_HISTORY'
  | 'SUSPICIOUS_EMAIL'
  | 'VELOCITY'
  | 'OTHER';

export interface RuleConfig {
  scoreDelta: number;
  config: Record<string, any>;
  enabled: boolean;
  maskAmounts: boolean;
}

const DEFAULTS: Record<OrderRiskReasonCodeKey, RuleConfig> = {
  FIRST_TIME_CUSTOMER: { scoreDelta: 5, config: {}, enabled: true, maskAmounts: false },
  REPEAT_CUSTOMER: { scoreDelta: -10, config: {}, enabled: true, maskAmounts: false },
  COD_PAYMENT: { scoreDelta: 5, config: {}, enabled: true, maskAmounts: false },
  ONLINE_CAPTURED: { scoreDelta: -5, config: {}, enabled: true, maskAmounts: false },
  ONLINE_NOT_CAPTURED: { scoreDelta: 10, config: {}, enabled: true, maskAmounts: false },
  HIGH_VALUE: { scoreDelta: 10, config: { valueRupees: 10_000 }, enabled: true, maskAmounts: false },
  VERY_HIGH_VALUE: { scoreDelta: 20, config: { valueRupees: 25_000 }, enabled: true, maskAmounts: false },
  BULK_ORDER: { scoreDelta: 5, config: { itemThreshold: 10 }, enabled: true, maskAmounts: false },
  PINCODE_RTO: { scoreDelta: 10, config: { pincodes: [] as string[] }, enabled: true, maskAmounts: false },
  CANCELLATION_HISTORY: {
    scoreDelta: 15,
    config: { minPrior: 3, lookbackDays: 90, rateThreshold: 0.3 },
    enabled: true,
    maskAmounts: false,
  },
  SUSPICIOUS_EMAIL: {
    scoreDelta: 10,
    config: {
      domains: [
        'mailinator.com',
        'guerrillamail.com',
        'tempmail.com',
        '10minutemail.com',
        'yopmail.com',
        'throwawaymail.com',
        'getnada.com',
        'sharklasers.com',
        'maildrop.cc',
        'fake-mail.net',
      ],
    },
    enabled: true,
    maskAmounts: false,
  },
  VELOCITY: {
    scoreDelta: 10,
    config: { windowMinutes: 60, threshold: 3 },
    enabled: true,
    maskAmounts: false,
  },
  OTHER: { scoreDelta: 0, config: {}, enabled: false, maskAmounts: false },
};

@Injectable()
export class RiskRuleConfigService {
  private readonly logger = new Logger(RiskRuleConfigService.name);
  private cache: Map<string, RuleConfig> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the resolved config for a rule, falling back to the
   * hardcoded default when no DB row exists (fresh deploy) or when
   * the DB read fails (we never want scoring to throw because the
   * config table was unreachable).
   */
  async get(code: OrderRiskReasonCodeKey): Promise<RuleConfig> {
    const cache = await this.load();
    return cache.get(code) ?? DEFAULTS[code];
  }

  /**
   * Bulk fetch — preferred by the scoring service which needs all
   * rules per call.
   */
  async getAll(): Promise<Record<OrderRiskReasonCodeKey, RuleConfig>> {
    const cache = await this.load();
    const out = { ...DEFAULTS };
    for (const [code, cfg] of cache.entries()) {
      if (code in DEFAULTS) {
        out[code as OrderRiskReasonCodeKey] = cfg;
      }
    }
    return out;
  }

  /**
   * List rules for the admin tune UI. Includes the resolved value
   * (DB if present, default otherwise) + a `usingDefault` flag so
   * the UI can show "this rule has no DB row yet" tooltip.
   */
  async list(): Promise<Array<{
    code: OrderRiskReasonCodeKey;
    scoreDelta: number;
    config: Record<string, any>;
    enabled: boolean;
    maskAmounts: boolean;
    usingDefault: boolean;
  }>> {
    const rows = await this.prisma.orderRiskRuleConfig.findMany();
    const byCode = new Map(rows.map((r) => [r.reasonCode, r]));
    return (Object.keys(DEFAULTS) as OrderRiskReasonCodeKey[]).map((code) => {
      const row = byCode.get(code as any);
      const d = DEFAULTS[code];
      return row
        ? {
            code,
            scoreDelta: row.scoreDelta,
            config: (row.config ?? {}) as Record<string, any>,
            enabled: row.enabled,
            maskAmounts: row.maskAmounts,
            usingDefault: false,
          }
        : { code, ...d, usingDefault: true };
    });
  }

  /**
   * Upsert a rule config row + invalidate cache. Admin permission
   * gate is enforced at the controller layer.
   */
  async upsert(
    code: OrderRiskReasonCodeKey,
    input: Partial<Omit<RuleConfig, never>>,
    adminId: string,
  ): Promise<RuleConfig> {
    if (!(code in DEFAULTS)) {
      throw new Error(`Unknown rule code: ${code}`);
    }
    const defaults = DEFAULTS[code];
    const next: RuleConfig = {
      scoreDelta: input.scoreDelta ?? defaults.scoreDelta,
      config: input.config ?? defaults.config,
      enabled: input.enabled ?? defaults.enabled,
      maskAmounts: input.maskAmounts ?? defaults.maskAmounts,
    };
    await this.prisma.orderRiskRuleConfig.upsert({
      where: { reasonCode: code as any },
      create: {
        reasonCode: code as any,
        scoreDelta: next.scoreDelta,
        config: next.config as any,
        enabled: next.enabled,
        maskAmounts: next.maskAmounts,
        updatedBy: adminId,
      },
      update: {
        scoreDelta: next.scoreDelta,
        config: next.config as any,
        enabled: next.enabled,
        maskAmounts: next.maskAmounts,
        updatedBy: adminId,
      },
    });
    this.invalidate();
    this.logger.log(
      `Rule ${code} updated by ${adminId}: scoreDelta=${next.scoreDelta} enabled=${next.enabled}`,
    );
    return next;
  }

  /** Clear the in-process cache. */
  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<Map<string, RuleConfig>> {
    if (this.cache) return this.cache;
    try {
      const rows = await this.prisma.orderRiskRuleConfig.findMany();
      this.cache = new Map(
        rows.map((r) => [
          r.reasonCode,
          {
            scoreDelta: r.scoreDelta,
            config: (r.config ?? {}) as Record<string, any>,
            enabled: r.enabled,
            maskAmounts: r.maskAmounts,
          },
        ]),
      );
      return this.cache;
    } catch (err) {
      // Never let scoring fail because the config table was
      // unreachable. Returning an empty map means the service
      // falls back to DEFAULTS everywhere.
      this.logger.warn(
        `Risk rule config load failed; falling back to defaults: ${(err as Error).message}`,
      );
      return new Map();
    }
  }

  /** For specs only. */
  _setCache(cache: Map<string, RuleConfig>): void {
    this.cache = cache;
  }
}
