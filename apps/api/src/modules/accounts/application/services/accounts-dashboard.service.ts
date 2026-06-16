import { Injectable, Inject } from '@nestjs/common';
import {
  AccountsRepository,
  ACCOUNTS_REPOSITORY,
  RankMetric,
  RankNodeType,
} from '../../domain/repositories/accounts.repository.interface';
import { NotFoundAppException } from '../../../../core/exceptions';

/**
 * Phase 175 (Accounts Overview audit #12) — a tiny in-process TTL cache. The
 * overview runs ~11 parallel aggregates per call and the values change slowly
 * (settlements run daily), so a 120s cache keyed by (method, date-range) keeps
 * an admin hammering refresh from re-aggregating the whole platform every load.
 * Per-instance (acceptable for a dashboard); multi-instance each holds its own.
 */
@Injectable()
export class AccountsDashboardService {
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly TTL_MS = 120_000;

  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
  ) {}

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await fn();
    this.cache.set(key, { value, expiresAt: now + this.TTL_MS });
    if (this.cache.size > 200) {
      for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
    }
    return value;
  }

  private key(prefix: string, ...parts: Array<Date | number | string | undefined>): string {
    return (
      prefix +
      ':' +
      parts.map((p) => (p instanceof Date ? p.getTime() : p ?? '')).join('|')
    );
  }

  async getPlatformOverview(fromDate?: Date, toDate?: Date) {
    return this.cached(this.key('platform', fromDate, toDate), () =>
      this.accountsRepo.getPlatformFinanceSummary({ fromDate, toDate }),
    );
  }

  async getSellerOverview(
    fromDate?: Date,
    toDate?: Date,
    allowedSellerTypes?: ('D2C' | 'RETAIL')[] | null,
  ) {
    // Isolation fix (2026-06-16) — the scope is part of the cache key, else a
    // scoped admin and an unrestricted admin would share a cached entry (leak).
    const scopeKey = allowedSellerTypes?.join(',') || 'all';
    return this.cached(this.key('seller', fromDate, toDate, scopeKey), () =>
      this.accountsRepo.getSellerFinanceSummary({ fromDate, toDate, allowedSellerTypes }),
    );
  }

  async getFranchiseOverview(fromDate?: Date, toDate?: Date) {
    return this.cached(this.key('franchise', fromDate, toDate), () =>
      this.accountsRepo.getFranchiseFinanceSummary({ fromDate, toDate }),
    );
  }

  // Phase 175 (#18) — optional point-in-time asOfDate. Phase 178 — aging shape.
  async getOutstandingPayables(asOfDate?: Date) {
    return this.cached(this.key('outstanding', asOfDate), () =>
      this.accountsRepo.getOutstandingPayables(asOfDate),
    );
  }

  // Phase 178 (#4/#11) — freeze / release a settlement; clears the cache so the
  // aging buckets reflect the change immediately.
  async setSettlementHold(args: {
    nodeType: 'SELLER' | 'FRANCHISE';
    settlementId: string;
    hold: boolean;
    holdReason?: string | null;
    adminId?: string;
  }) {
    const result = await this.accountsRepo.setSettlementHold(args);
    this.cache.clear();
    return result;
  }

  // Phase 178 (#12) — record a partial / full disbursement; clears the cache.
  async recordSettlementPayment(args: {
    nodeType: 'SELLER' | 'FRANCHISE';
    settlementId: string;
    amountInPaise: bigint;
    adminId?: string;
  }) {
    const result = await this.accountsRepo.recordSettlementPayment(args);
    this.cache.clear();
    return result;
  }

  // Phase 175 (#19) — page-able top performers. Phase 179 — metric-selectable
  // (#1), node-type-scoped (#14, skips the unneeded query), with explicit
  // revenue-basis + methodology (#5/#12/#17/#18).
  async getTopPerformers(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    page = 1,
    metric: RankMetric = 'REVENUE',
    nodeType: RankNodeType = 'ALL',
    allowedSellerTypes?: ('D2C' | 'RETAIL')[] | null,
  ) {
    const offset = (Math.max(1, page) - 1) * limit;
    // Isolation fix (2026-06-16) — scope the SELLER leaderboard to the admin's
    // type(s); franchise rankings are a separate domain (left blended per the
    // product call). Scope is part of the cache key to avoid cross-admin leak.
    const scopeKey = allowedSellerTypes?.join(',') || 'all';
    return this.cached(
      this.key('top', limit, fromDate, toDate, offset, metric, nodeType, scopeKey),
      async () => {
        const wantSellers = nodeType === 'ALL' || nodeType === 'SELLER';
        const wantFranchises = nodeType === 'ALL' || nodeType === 'FRANCHISE';
        const [topSellers, topFranchises] = await Promise.all([
          wantSellers
            ? this.accountsRepo.getTopSellers(limit, fromDate, toDate, offset, metric, allowedSellerTypes)
            : Promise.resolve([]),
          wantFranchises
            ? this.accountsRepo.getTopFranchises(limit, fromDate, toDate, offset, metric)
            : Promise.resolve([]),
        ]);
        return {
          topSellers,
          topFranchises,
          page: Math.max(1, page),
          limit,
          metric,
          nodeType,
          // #5 — the two lists use DIFFERENT revenue bases and are NOT a single
          // comparable ranking; surfaced so a consumer never falsely merges them.
          revenueBasis: {
            sellers: 'Commission base (order value the platform commissions on), net of refunds',
            franchises: 'Online order value + net POS sales (reconciles with the per-franchise dashboard)',
          },
          // #12/#17/#18 — explicit, auditable methodology.
          methodology:
            'Sellers ranked from commission records by created date, net of refunded admin earning. ' +
            'Franchises ranked from ONLINE_ORDER ledger + net POS sales (voids & returns removed); ' +
            'margin = online + procurement platform earning. Platform-level expenses (goodwill credits, ' +
            'chargebacks) are NOT attributed per node — they are platform-funded, not commission reversals.',
        };
      },
    );
  }

  // ── Phase 176: per-seller drill-down ──────────────────────────

  async getSellerAccountsOverview(sellerId: string, fromDate?: Date, toDate?: Date) {
    const cacheKey = this.key('seller-overview', sellerId, fromDate, toDate);
    const data = await this.cached(cacheKey, () =>
      this.accountsRepo.getSellerAccountsOverview(sellerId, fromDate, toDate),
    );
    if (!data) {
      this.cache.delete(cacheKey); // don't let a 404 stick for the TTL
      throw new NotFoundAppException('Seller not found');
    }
    return data;
  }

  async getSellerCommissionRecords(
    sellerId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    return this.cached(
      this.key('seller-commission', sellerId, fromDate, toDate, page, limit),
      () => this.accountsRepo.getSellerCommissionRecords(sellerId, fromDate, toDate, page, limit),
    );
  }

  async getSellerSettlements(
    sellerId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    return this.cached(
      this.key('seller-settlements', sellerId, fromDate, toDate, page, limit),
      () => this.accountsRepo.getSellerSettlements(sellerId, fromDate, toDate, page, limit),
    );
  }

  // ── Phase 177: per-franchise drill-down ───────────────────────

  async getFranchiseAccountsOverview(franchiseId: string, fromDate?: Date, toDate?: Date) {
    const cacheKey = this.key('franchise-overview', franchiseId, fromDate, toDate);
    const data = await this.cached(cacheKey, () =>
      this.accountsRepo.getFranchiseAccountsOverview(franchiseId, fromDate, toDate),
    );
    if (!data) {
      this.cache.delete(cacheKey);
      throw new NotFoundAppException('Franchise not found');
    }
    return data;
  }

  async getFranchiseLedgerEntries(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
    sourceType?: string,
    status?: string,
  ) {
    return this.cached(
      this.key('franchise-ledger', franchiseId, fromDate, toDate, page, limit, sourceType, status),
      () => this.accountsRepo.getFranchiseLedgerEntries(franchiseId, fromDate, toDate, page, limit, sourceType, status),
    );
  }

  async getFranchiseReconciliationDiscrepancies(
    franchiseId: string,
    status: string | undefined,
    page: number,
    limit: number,
  ) {
    return this.cached(
      this.key('franchise-recon', franchiseId, status, page, limit),
      () => this.accountsRepo.getFranchiseReconciliationDiscrepancies(franchiseId, status, page, limit),
    );
  }

  // Phase 177 (#4) — write path; clears the dashboard cache so the new
  // adjustment + the shifted payable show immediately.
  async createFranchiseSettlementAdjustment(args: {
    settlementId: string;
    amount: string;
    adjustmentType: import('@prisma/client').SettlementAdjustmentType;
    notes?: string | null;
    adminId?: string;
  }) {
    const result = await this.accountsRepo.createFranchiseSettlementAdjustment(args);
    this.cache.clear();
    return result;
  }

  async getFranchisePosSales(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    return this.cached(
      this.key('franchise-pos', franchiseId, fromDate, toDate, page, limit),
      () => this.accountsRepo.getFranchisePosSales(franchiseId, fromDate, toDate, page, limit),
    );
  }

  async getFranchiseSettlementsList(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    return this.cached(
      this.key('franchise-settlements', franchiseId, fromDate, toDate, page, limit),
      () => this.accountsRepo.getFranchiseSettlementsList(franchiseId, fromDate, toDate, page, limit),
    );
  }
}
