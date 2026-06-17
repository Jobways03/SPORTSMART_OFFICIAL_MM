import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PostOfficeCacheService } from './post-office-cache.service';
import { StockMovementLedgerService } from '../../../inventory/application/services/stock-movement-ledger.service';
import { MAX_RESERVATION_QUANTITY } from '../../../inventory/application/facades/inventory-public.facade';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface AllocatedSeller {
  nodeType: 'SELLER' | 'FRANCHISE';
  // Tiered cascade (2026-06-16) — the allocation tier this candidate belongs to.
  // RETAIL (local, ≤ radius) and D2C (nationwide) are both nodeType:'SELLER' but
  // sit in different cascade tiers; FRANCHISE is its own tier. Used to drive the
  // Retail → Franchise → D2C priority and for explainability.
  tier: 'RETAIL' | 'FRANCHISE' | 'D2C';
  sellerId: string;        // seller ID or franchise ID
  sellerName: string;      // seller name or franchise name
  franchiseId?: string;    // only set when nodeType is FRANCHISE
  mappingId: string;       // SellerProductMapping ID or FranchiseCatalogMapping ID
  // Phase 64 (2026-05-22) — distanceKm is now nullable (audit
  // Gap #9). Pre-Phase-64 the allocator used `distance: 999` as a
  // placeholder for "no coordinates", which competed against real
  // 200km sellers as a not-quite-furthest candidate. Now a
  // candidate with no resolvable distance is represented as `null`
  // and excluded from distance-based ranking.
  distanceKm: number | null;
  dispatchSla: number;
  availableStock: number;
  estimatedDeliveryDays: number;
  score: number;
  // Phase 159m — set only for FRANCHISE candidates selected via an admin
  // pincode→franchise territory mapping. `pincodeMappingId` is snapshot onto
  // the AllocationLog; `mappingPriority` (higher wins) feeds the score so a
  // priority-100 franchise outranks a priority-50 one for the same pincode.
  pincodeMappingId?: string;
  mappingPriority?: number;
  // The node's registered pickup PIN — seller mapping `pickupPincode` or
  // franchise `warehousePincode` — used to ask Delhivery for the real transit
  // TAT (pickup PIN → customer PIN) on the storefront serviceability check.
  pickupPincode?: string | null;
  // Phase 231/232 (Eligible-node + Allocation-preview audit) — human-readable
  // explainability for WHY this candidate is eligible + how it scored. The
  // routing-preview + eligible-node frontends already declare a `reasons:
  // string[]` field and render it; pre-231 the backend never populated it, so
  // the UI branch was always empty (dead). Lightweight, derived at build time.
  reasons?: string[];
}

// Phase 233 (Allocation Analytics audit) — provenance tag threaded into every
// allocation_logs write so analytics can tell a real checkout decision (LIVE)
// from an admin browse (LISTING), a dry-run (PREVIEW), an authenticated cart
// serviceability check (STOREFRONT), or a system/admin re-route. Defaults to
// LIVE so existing callers (real checkout) are counted unchanged.
export type AllocationEventSourceTag =
  | 'LIVE'
  | 'REALLOCATION'
  | 'MANUAL_REASSIGNMENT'
  | 'LISTING'
  | 'PREVIEW'
  | 'STOREFRONT';

/**
 * Phase 64 (2026-05-22) — typed reason enum for unserviceable
 * outcomes (audit Gap #16). Pre-Phase-64 the checkout returned
 * three hardcoded English strings; ops + support couldn't tell
 * out-of-stock from no-mapping from no-service-area.
 */
export type ServiceabilityReason =
  | 'OK'
  | 'NO_MAPPING'
  | 'OUT_OF_STOCK'
  | 'NO_SERVICE_AREA'
  | 'DISTANCE_EXCEEDED'
  | 'PRODUCT_INACTIVE'
  | 'VARIANT_INACTIVE'
  | 'PINCODE_UNKNOWN'
  | 'RACE_LOST';

export interface AllocationResult {
  serviceable: boolean;
  /**
   * Phase 64 (audit Gap #16) — typed reason for why an allocation
   * was unserviceable. 'OK' on success.
   */
  reason: ServiceabilityReason;
  primary: AllocatedSeller | null;
  secondary: AllocatedSeller | null;
  tertiary: AllocatedSeller | null;
  allEligible: AllocatedSeller[];
}

export interface StockReservationResult {
  id: string;
  mappingId: string;
  quantity: number;
  status: string;
  orderId: string | null;
  expiresAt: Date;
}

export interface AllocateAndReserveResult {
  allocation: AllocationResult;
  reservation: StockReservationResult;
  chosenCandidate: AllocatedSeller;
  /** Which slot in the ranked candidates list won the reservation. */
  chosenRank: 'primary' | 'secondary' | 'tertiary' | 'fallback';
  /** Mapping IDs that were attempted but lost the race. */
  skippedMappingIds: string[];
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SellerAllocationService {
  private readonly logger = new Logger(SellerAllocationService.name);

  // Phase 52 (2026-05-21) — pre-Phase-52 the constructor wired a
  // 60s setInterval that ran releaseExpiredReservations(); the
  // leader-elected ReservationExpirySweepCron is now the canonical
  // expiry path. Both running together emitted duplicate events
  // and burned DB cycles on the non-leader pods, so the local
  // interval has been removed. The releaseExpiredReservations
  // method stays — it's still useful from tests + manual ops.

  // Scoring weights — configurable via env, cached at startup.
  private readonly wDistance: number;
  private readonly wStock: number;
  private readonly wSla: number;
  // Phase 159m — weight for an admin pincode→franchise territory mapping's
  // priority (0..1000, normalised). Only contributes for franchise candidates
  // selected via a mapping; sellers + unmapped franchises get 0 here, so the
  // unmapped routing path is unchanged.
  private readonly wPincodePriority: number;
  // Phase 64 (2026-05-22) — Haversine cap above which a candidate
  // is filtered out as unserviceable (audit Gap #8). 0 disables the
  // cap (back-compat for tests). Pre-Phase-64 a Chennai customer
  // could be routed to a Punjab seller 2500km away — technically
  // serviceable but practically a 5-7 day shipment with broken UX.
  private readonly maxDistanceKm: number;
  // Tiered cascade (2026-06-16) — retail sellers are local-only; eligible only
  // within this Haversine radius of the customer. Franchise + D2C are nationwide.
  private readonly retailRadiusKm: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    // Phase 4 follow-up (2026-05-16) — pincode coordinate lookup cache.
    // Hot path: every allocation hits post_offices ~50 times under
    // typical multi-seller routing. The cache moves all but the first
    // lookup per pincode off the DB.
    private readonly postOfficeCache: PostOfficeCacheService,
    // Phase 52 polish (2026-05-21) — ledger writes for the allocation
    // reservation path so checkout-driven reservations land in the
    // forensic trail alongside facade-driven ones.
    private readonly stockLedger: StockMovementLedgerService,
  ) {
    this.wDistance = this.envService.getNumber('ROUTING_DISTANCE_WEIGHT', 0.7);
    this.wStock = this.envService.getNumber('ROUTING_STOCK_WEIGHT', 0.2);
    this.wSla = this.envService.getNumber('ROUTING_SLA_WEIGHT', 0.1);
    this.wPincodePriority = this.envService.getNumber(
      'ROUTING_PINCODE_PRIORITY_WEIGHT',
      0.5,
    );
    this.maxDistanceKm = this.envService.getNumber('ROUTING_MAX_DISTANCE_KM', 1500);
    this.retailRadiusKm = this.envService.getNumber('RETAIL_LOCAL_RADIUS_KM', 50);
  }

  // ── T1-T2  Core allocation ─────────────────────────────────────────────

  /**
   * Allocates the best fulfillment node for a product/variant at a customer
   * pincode using a TIERED CASCADE (2026-06-16): Retail → Franchise → D2C.
   *
   * The first tier with ANY eligible candidate wins; lower tiers are not
   * consulted. So an eligible retail seller always beats a franchise/D2C, even
   * a closer/cheaper one.
   *   - RETAIL: local only — stock + service-area + Haversine distance ≤
   *     RETAIL_LOCAL_RADIUS_KM (default 50; 0 = nationwide). A retail seller
   *     beyond the radius (or with no resolvable pickup coords) is not eligible.
   *   - FRANCHISE: nationwide (no distance cap).
   *   - D2C: nationwide (no distance cap).
   *
   * Within the chosen tier, candidates are ranked by the existing weighted score
   * (distance / stock / SLA / franchise territory-priority / manual priority):
   *  - Distance: ROUTING_DISTANCE_WEIGHT (default 0.7, lower = better, Haversine)
   *  - Stock confidence: ROUTING_STOCK_WEIGHT (default 0.2, more stock = better)
   *  - Dispatch SLA: ROUTING_SLA_WEIGHT (default 0.1, faster = better)
   *
   * primary/secondary/tertiary/allEligible are all from the winning tier.
   */
  async allocate(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    excludeMappingIds?: string[];
    // Phase 231 (Eligible-node audit) — when 'COD', exclude nodes that don't
    // accept cash-on-delivery for this pincode (seller SellerServiceArea.codEligible
    // / franchise FranchisePartner.codEnabled). Omitted/ONLINE => no COD filter
    // (pre-231 behaviour). Routing a COD order to a non-COD node otherwise
    // guarantees a downstream rejection cascade.
    paymentMethod?: 'COD' | 'ONLINE';
    // Phase 233 (Analytics audit) — provenance for the allocation_logs row.
    // Defaults to LIVE; admin listing/preview + storefront cart checks pass a
    // non-LIVE tag so they don't inflate real-checkout analytics.
    eventSource?: AllocationEventSourceTag;
    // Phase 233 — suppress the allocation_logs write entirely. Used by
    // reallocate(), which re-runs allocate() internally and writes itself one
    // canonical REALLOCATION row — without this the reallocation would
    // double-write (one LIVE-ish row from the inner allocate + one explicit).
    skipLog?: boolean;
  }): Promise<AllocationResult> {
    const { productId, variantId, customerPincode, quantity, excludeMappingIds, paymentMethod } = input;

    if (!productId) throw new BadRequestAppException('productId is required');
    if (!customerPincode) throw new BadRequestAppException('customerPincode is required');
    if (quantity < 1) throw new BadRequestAppException('quantity must be >= 1');

    // Phase 64 (2026-05-22) — pincode format validation (audit Gap
    // #19). Pre-Phase-64 a garbage value `abc123` flowed through to
    // the PostOffice cache miss → customerCoords=null → every
    // mapping ranked at 999km → "serviceable" with bizarre output.
    // Reject at the entry point with a typed reason so the caller
    // can surface PINCODE_UNKNOWN.
    if (!/^[1-9][0-9]{5}$/.test(customerPincode)) {
      return {
        serviceable: false,
        reason: 'PINCODE_UNKNOWN',
        primary: null,
        secondary: null,
        tertiary: null,
        allEligible: [],
      };
    }

    // Phase 64 (audit Gap #27) — reject when the product is not
    // ACTIVE or has been soft-deleted. Pre-Phase-64 an admin-
    // deactivated product would still allocate if the mappings
    // hadn't been cleaned up, leaving customers able to checkout a
    // PAUSED/ARCHIVED product. Check runs BEFORE the pincode
    // PostOffice lookup so a customer browsing a deactivated
    // product gets the precise reason (PRODUCT_INACTIVE) instead
    // of a generic PINCODE_UNKNOWN if their pincode also happens
    // to be unmapped.
    const productRow = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { status: true, isDeleted: true },
    });
    if (!productRow || productRow.isDeleted || productRow.status !== 'ACTIVE') {
      return {
        serviceable: false,
        reason: 'PRODUCT_INACTIVE',
        primary: null,
        secondary: null,
        tertiary: null,
        allEligible: [],
      };
    }

    // 1. Customer pincode coordinates — Redis-cached (24h TTL) so the
    //    165K-row post_offices table is touched at most once per
    //    pincode per day (Phase 4 follow-up, 2026-05-16).
    const customerCoords = await this.postOfficeCache.lookup(customerPincode);
    const customerLat = customerCoords?.latitude ?? null;
    const customerLon = customerCoords?.longitude ?? null;

    // Phase 64 (audit Gap #19) — if PostOffice has no coords for
    // the supplied pincode, surface PINCODE_UNKNOWN. Pre-Phase-64
    // this fell through to the 999-km placeholder path.
    if (customerLat === null || customerLon === null) {
      return {
        serviceable: false,
        reason: 'PINCODE_UNKNOWN',
        primary: null,
        secondary: null,
        tertiary: null,
        allEligible: [],
      };
    }

    // 2. Find all active + approved seller mappings for this product/variant.
    //
    // Phase 77 (2026-05-22) — align with franchise variant-fallback
    // semantics (audit Gap #3). Pre-Phase-77 the seller path required
    // exact variantId equality while the franchise path used
    // `OR: [{ variantId }, { variantId: null }]`. A product with
    // variants and only product-level (variantId=null) seller
    // mappings deflected to franchises while sellers existed. Now
    // both sides match the same variant-OR-product-level rule.
    // Variant-specific mappings still win at scoring time (the
    // input ordering keeps variant-specific rows ahead of
    // wildcards; `seen` dedupe in the seller loop keeps the
    // first-seen mapping per seller).
    const mappingWhere: any = {
      productId,
      isActive: true,
      approvalStatus: 'APPROVED',
    };
    if (variantId) {
      mappingWhere.OR = [{ variantId }, { variantId: null }];
    }
    if (excludeMappingIds && excludeMappingIds.length > 0) {
      mappingWhere.id = { notIn: excludeMappingIds };
    }

    // Deterministic tiebreak: when two sellers end up with the same allocation
    // score, the stable sort at L#274 preserves this input order — so an
    // explicit orderBy prevents different API instances from routing the
    // same order to different sellers.
    const sellerMappings = await this.prisma.sellerProductMapping.findMany({
      where: mappingWhere,
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            status: true,
            // Tiered cascade (2026-06-16) — RETAIL (local) vs D2C (nationwide)
            // sit in different cascade tiers, so we must read the type here.
            sellerType: true,
            // Phase 230 — manual fulfillment hold; held sellers are excluded.
            fulfillmentHold: true,
          },
        },
      },
      // Phase 77 (audit Gap #3) — variant-specific rows first so the
      // dedupe loop below keeps variant rows over product-level
      // wildcards. Then mappingId asc as the deterministic tiebreak.
      orderBy: [{ variantId: 'desc' }, { id: 'asc' }],
    });

    // Phase 77 — dedupe by sellerId. With the variant-OR-product-level
    // query (Gap #3), a single seller can appear twice for a variant
    // order (once via the variant-specific mapping, once via the
    // product-level fallback). The `variantId: 'desc'` orderBy puts
    // variant-specific rows first, so a Set keeps the right one.
    const sellerSeen = new Set<string>();
    const dedupedMappings = sellerMappings.filter((m) => {
      if (sellerSeen.has(m.sellerId)) return false;
      sellerSeen.add(m.sellerId);
      return true;
    });

    // Keep only ACTIVE, not-on-hold sellers with enough available stock.
    // Phase 230 — a seller on a manual fulfillment hold (fraud / compliance
    // review) is excluded from eligibility entirely, not merely down-ranked.
    const stockEligible = dedupedMappings.filter((m) => {
      if (m.seller.status !== 'ACTIVE') return false;
      if (m.seller.fulfillmentHold) return false;
      const available = m.stockQty - m.reservedQty;
      return available >= quantity;
    });

    // Enforce SellerServiceArea for sellers that opted in. A seller with ANY
    // active service-area row is treated as "explicitly restricted" — the
    // customer pincode must be in their set. Sellers with no rows keep
    // distance-only behavior (backwards compatible).
    const candidateSellerIds = stockEligible.map((m) => m.sellerId);
    let optedInSellers = new Set<string>();
    let servingThisPincode = new Set<string>();
    // Phase 231 — sellers whose service-area row for this pincode accepts COD.
    let codServingThisPincode = new Set<string>();
    if (candidateSellerIds.length > 0) {
      const [optedIn, serving] = await Promise.all([
        this.prisma.sellerServiceArea.findMany({
          where: {
            sellerId: { in: candidateSellerIds },
            isActive: true,
          },
          select: { sellerId: true },
          distinct: ['sellerId'],
        }),
        this.prisma.sellerServiceArea.findMany({
          where: {
            sellerId: { in: candidateSellerIds },
            pincode: customerPincode,
            isActive: true,
          },
          select: { sellerId: true, codEligible: true },
        }),
      ]);
      optedInSellers = new Set(optedIn.map((r) => r.sellerId));
      servingThisPincode = new Set(serving.map((r) => r.sellerId));
      codServingThisPincode = new Set(
        serving.filter((r) => r.codEligible).map((r) => r.sellerId),
      );
    }
    const eligible = stockEligible.filter((m) => {
      // Service-area opt-in: an opted-in seller must serve this pincode.
      if (optedInSellers.has(m.sellerId) && !servingThisPincode.has(m.sellerId)) {
        return false;
      }
      // Phase 231 — COD: an opted-in seller serving this pincode via a
      // codEligible=false row can't take a COD order. Non-opted-in sellers
      // (no service areas) are implicitly COD-capable — unchanged.
      if (
        paymentMethod === 'COD' &&
        optedInSellers.has(m.sellerId) &&
        !codServingThisPincode.has(m.sellerId)
      ) {
        return false;
      }
      return true;
    });

    // 3. Compute the customer→pickup Haversine distance for every stock- and
    //    service-area-eligible seller mapping. Tiered cascade (2026-06-16):
    //    there is NO global distance cap here — the per-tier rule below applies
    //    it (RETAIL ≤ retailRadiusKm; D2C nationwide). Distance stays nullable
    //    for no-coords mappings (it contributes 0 to the within-tier score).
    const pincodesToFetch = new Set<string>();
    for (const m of eligible) {
      if ((m.latitude == null || m.longitude == null) && m.pickupPincode) {
        pincodesToFetch.add(m.pickupPincode);
      }
    }
    const pincodeCoords =
      pincodesToFetch.size > 0
        ? await this.postOfficeCache.lookupMany(Array.from(pincodesToFetch))
        : new Map();

    // 4. Build seller candidates (RETAIL + D2C), tagging each with its cascade
    //    tier from the seller's type. Distance is computed for all; the retail
    //    radius gate is applied at the tier-split below.
    const sellerCandidates: AllocatedSeller[] = eligible.map((mapping) => {
      let distance: number | null = null;
      let sellerLat = mapping.latitude ? Number(mapping.latitude) : null;
      let sellerLon = mapping.longitude ? Number(mapping.longitude) : null;
      if ((sellerLat == null || sellerLon == null) && mapping.pickupPincode) {
        const sellerCoords = pincodeCoords.get(mapping.pickupPincode);
        if (sellerCoords?.latitude != null && sellerCoords?.longitude != null) {
          sellerLat = sellerCoords.latitude;
          sellerLon = sellerCoords.longitude;
        }
      }
      // Explicit null checks (not truthiness): a valid coordinate of exactly 0
      // is falsy, and for a RETAIL seller a null distance means exclusion from
      // the local tier — so `&&` would silently drop a 0-axis pickup. Matches
      // the `!= null` convention used elsewhere in this file.
      if (
        customerLat != null &&
        customerLon != null &&
        sellerLat != null &&
        sellerLon != null
      ) {
        distance = this.calculateDistance(customerLat, customerLon, sellerLat, sellerLon);
      }

      const tier: 'RETAIL' | 'D2C' =
        mapping.seller.sellerType === 'RETAIL' ? 'RETAIL' : 'D2C';
      const avail = mapping.stockQty - mapping.reservedQty;
      // Phase 230 — operationalPriority ("manual preferred seller"); >0 only.
      const priority =
        mapping.operationalPriority > 0 ? mapping.operationalPriority : undefined;
      return {
        nodeType: 'SELLER' as const,
        tier,
        sellerId: mapping.seller.id,
        sellerName: mapping.seller.sellerShopName || mapping.seller.sellerName,
        mappingId: mapping.id,
        distanceKm: distance !== null ? Math.round(distance * 100) / 100 : null,
        dispatchSla: mapping.dispatchSla,
        availableStock: avail,
        estimatedDeliveryDays: this.estimateDeliveryDays(distance ?? 0, mapping.dispatchSla),
        score: 0, // scored within the chosen tier below
        mappingPriority: priority,
        pickupPincode: mapping.pickupPincode ?? null,
        // Phase 231/232 — explainability (rendered by routing-preview UI).
        reasons: [
          `tier:${tier.toLowerCase()}`,
          optedInSellers.has(mapping.seller.id)
            ? 'within-service-area'
            : 'distance-coverage',
          `stock-ok (${avail} avail)`,
          distance !== null
            ? `distance ${Math.round(distance * 100) / 100}km`
            : 'distance-unknown',
          ...(priority !== undefined ? [`priority ${priority}`] : []),
        ],
      };
    });

    // 5. Build the three cascade tiers. The cascade priority (Retail → Franchise
    //    → D2C) is enforced at step 6 by the ORDER of `allEligible` (retail block
    //    first), so a closer/cheaper franchise or D2C never becomes the primary
    //    over an eligible retail seller. All three tiers are still computed (the
    //    franchise query runs eagerly below) so the lower tiers are available as
    //    the cross-tier reservation fallback chain.
    //
    //    RETAIL is LOCAL ONLY: a retail seller qualifies only with a KNOWN
    //    distance within retailRadiusKm. A retail seller with no resolvable
    //    pickup coords, or beyond the radius, is not eligible at all — there is
    //    no nationwide retail fallback, so "the only stock is a far retail
    //    seller" correctly yields not-serviceable. retailRadiusKm <= 0 disables
    //    the radius (retail becomes nationwide too).
    const retailCandidates = sellerCandidates.filter((c) => {
      if (c.tier !== 'RETAIL') return false;
      if (this.retailRadiusKm <= 0) return true;
      return c.distanceKm !== null && c.distanceKm <= this.retailRadiusKm;
    });
    // D2C ships nationwide — every stock/service-area-eligible D2C seller
    // qualifies regardless of distance (distance still feeds the within-tier
    // score, so a nearer D2C seller ranks higher).
    const d2cCandidates = sellerCandidates.filter((c) => c.tier === 'D2C');

    // Franchises ship nationwide (no distance cap). Computed eagerly — even when
    // retail wins — so the cross-tier fallback chain below includes them.
    const franchiseCandidates = await this.findEligibleFranchises({
      productId,
      variantId,
      customerPincode,
      quantity,
      customerLat,
      customerLon,
      paymentMethod,
    });

    // 6. Score + sort EACH tier on its own (own distance/SLA normalisation), then
    //    concatenate in cascade priority order: Retail → Franchise → D2C. The
    //    blocks are ordered by TIER PRIORITY, not raw score — an eligible retail
    //    seller always precedes any franchise, which precedes any D2C. So
    //    `primary` (= allEligible[0]) is the cascade winner, while `allEligible`
    //    is the FULL cross-tier fallback chain: a reservation race on the primary
    //    can fall through to the next candidate (rest of its tier first, then the
    //    lower tiers) within this single allocation, honouring tier priority.
    const scoreTier = (tier: AllocatedSeller[]): AllocatedSeller[] => {
      if (tier.length === 0) return [];
      const known = tier
        .map((c) => c.distanceKm)
        .filter((d): d is number => d !== null);
      const maxDistance = known.length > 0 ? Math.max(...known, 1) : 1;
      const maxSla = Math.max(...tier.map((c) => c.dispatchSla), 1);
      const scoredTier = tier.map((candidate) => {
        let score = 0;
        // Distance score (lower = better); null distance contributes 0.
        if (candidate.distanceKm !== null) {
          score += this.wDistance * (1 - candidate.distanceKm / maxDistance);
        }
        score += this.wStock * Math.min(candidate.availableStock / quantity, 1);
        score += this.wSla * (1 - candidate.dispatchSla / maxSla);
        // Phase 159m — franchise territory-priority (only set for franchise rows).
        if (candidate.mappingPriority != null) {
          score += this.wPincodePriority * (candidate.mappingPriority / 1000);
        }
        return { ...candidate, score: Math.round(score * 10000) / 10000 };
      });
      // Deterministic within-tier order: score desc, mappingId asc (Phase 77).
      scoredTier.sort((a, b) => {
        const delta = b.score - a.score;
        if (delta !== 0) return delta;
        const am = a.mappingId ?? '';
        const bm = b.mappingId ?? '';
        return am < bm ? -1 : am > bm ? 1 : 0;
      });
      return scoredTier;
    };

    const allEligible: AllocatedSeller[] = [
      ...scoreTier(retailCandidates),
      ...scoreTier(franchiseCandidates),
      ...scoreTier(d2cCandidates),
    ];

    if (allEligible.length === 0) {
      // Phase 64 (audit Gap #16) — diagnose WHY nothing is serviceable,
      // seller-first since the cascade starts there. D2C is nationwide, so
      // reaching here with eligible sellers means they were all RETAIL beyond
      // the local radius (and no franchise/D2C covers the pincode).
      let reason: ServiceabilityReason = 'NO_MAPPING';
      if (sellerMappings.length > 0) {
        const seller0 = sellerMappings[0];
        if (seller0 && seller0.seller.status !== 'ACTIVE') {
          reason = 'NO_MAPPING';
        } else if (stockEligible.length === 0) {
          reason = 'OUT_OF_STOCK';
        } else if (eligible.length === 0) {
          reason = 'NO_SERVICE_AREA';
        } else {
          // Stock + service area passed, but the only eligible sellers are
          // retail sellers beyond the local radius.
          reason = 'DISTANCE_EXCEEDED';
        }
      }
      return {
        serviceable: false,
        reason,
        primary: null,
        secondary: null,
        tertiary: null,
        allEligible: [],
      };
    }

    // 7. Result. primary = the cascade winner (best of the highest-priority
    //    non-empty tier); allEligible = the full cross-tier fallback chain.
    this.logger.debug(
      `allocate ${productId}@${customerPincode}: winner=${allEligible[0]?.tier} chain=${allEligible
        .map((c) => c.tier)
        .join('>')} (${allEligible.length})`,
    );

    const result: AllocationResult = {
      serviceable: true,
      reason: 'OK',
      primary: allEligible[0] ?? null,
      secondary: allEligible[1] ?? null,
      tertiary: allEligible[2] ?? null,
      allEligible,
    };

    // 8. Log allocation decision (T7). Phase 233 — skipLog lets reallocate()
    // suppress this inner write so it isn't double-counted.
    if (!input.skipLog) {
      await this.logAllocation(input, result);
    }

    return result;
  }

  /**
   * Phase 64 (2026-05-22) — non-mutating preview of allocation
   * (audit Gaps #3 + #5). Reuses the full allocator pipeline —
   * service-area opt-in, available=stockQty-reservedQty, distance
   * cap, product status — so the PDP serviceability check and the
   * new cart preview return EXACTLY the same answer the checkout
   * allocator will. Pre-Phase-64 the PDP used a separate
   * ServiceabilityService with looser rules: it ignored
   * SellerServiceArea, used raw stockQty, and didn't enforce a
   * distance cap. Customers saw "deliverable" on PDP and
   * "unserviceable" at checkout for the SAME pincode.
   *
   * The method skips two side effects the full allocate() path
   * performs:
   *   - AllocationLog write (we don't want PDP page-load traffic
   *     polluting forensic queries)
   *   - reservation (the preview is read-only by contract)
   */
  async previewServiceability(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    paymentMethod?: 'COD' | 'ONLINE';
  }): Promise<AllocationResult> {
    // Skip the allocation_logs write for a read-only preview via the per-call
    // `skipLog` flag (lives on the `input` arg, not shared instance state).
    //
    // Was: temporarily NO-OPing `this.logAllocation` on the singleton — a race
    // under the parallel Promise.all preview/cart callers, where one preview
    // could blank out the logger while a concurrent REAL allocate() was mid-
    // flight, silently dropping its forensic log row. `skipLog` is race-free.
    return this.allocate({ ...input, skipLog: true, eventSource: 'PREVIEW' });
  }

  // ── T4  Stock reservation ──────────────────────────────────────────────

  /**
   * Phase 52 polish (2026-05-21) — the seller-allocation reservation
   * path is the primary checkout reservation creator. Pre-polish it
   * bypassed both the new attribution columns and the StockMovement
   * ledger that InventoryPublicFacade.reserveStock writes. This
   * version mirrors the facade's contract inline so every reservation
   * — whether created via the facade or the allocation path — carries
   * customerId attribution and lands in the ledger.
   */
  async reserveStock(input: {
    mappingId: string;
    quantity: number;
    orderId?: string;
    expiresInMinutes?: number;
    customerId?: string | null;
    sessionId?: string | null;
    cartId?: string | null;
  }): Promise<StockReservationResult> {
    const { mappingId, quantity, orderId, expiresInMinutes = 15 } = input;

    if (quantity < 1) throw new BadRequestAppException('quantity must be >= 1');
    if (quantity > MAX_RESERVATION_QUANTITY) {
      throw new BadRequestAppException(
        `quantity must not exceed ${MAX_RESERVATION_QUANTITY} units per reservation`,
      );
    }

    // Reserve inside a transaction with a row-level lock so concurrent
    // reservations against the same mapping serialize correctly.
    const txResult = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          stock_qty: number;
          reserved_qty: number;
          approval_status: string;
          is_active: boolean;
          deleted_at: Date | null;
        }>
      >`
        SELECT id, stock_qty, reserved_qty, approval_status, is_active, deleted_at
        FROM seller_product_mappings
        WHERE id = ${mappingId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
      }

      // The reserve primitive is exposed directly (POST /storefront/allocate/
      // reserve) and must self-enforce the mapping lifecycle — the allocator's
      // APPROVED + active filter only protects the allocate() path, not this
      // endpoint. Without this gate any authenticated caller could reserve (and
      // then confirm-deduct) stock against a mapping an admin had STOPPED, or
      // one that is unapproved / paused / soft-deleted, corrupting cross-seller
      // aggregate stock and routing inventory through a disabled node.
      if (
        locked.deleted_at !== null ||
        locked.is_active !== true ||
        locked.approval_status !== 'APPROVED'
      ) {
        throw new ConflictAppException(
          `Mapping ${mappingId} is not orderable`,
        );
      }

      const available = locked.stock_qty - locked.reserved_qty;
      if (available < quantity) {
        throw new ConflictAppException(
          `Insufficient stock: available=${available}, requested=${quantity}`,
        );
      }

      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

      const reservation = await tx.stockReservation.create({
        data: {
          mappingId,
          quantity,
          status: 'RESERVED',
          orderId: orderId ?? null,
          customerId: input.customerId ?? null,
          sessionId: input.sessionId ?? null,
          cartId: input.cartId ?? null,
          expiresAt,
        },
      });

      await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: { reservedQty: { increment: quantity } },
      });

      return {
        reservation,
        before: { stockQty: locked.stock_qty, reservedQty: locked.reserved_qty },
        after: { stockQty: locked.stock_qty, reservedQty: locked.reserved_qty + quantity },
      };
    });

    // Phase 52 polish — ledger write after the transaction commits.
    // Best-effort: a ledger failure must NOT roll back the reservation
    // (the source of truth is the StockReservation row).
    await this.stockLedger.record({
      resource: 'SellerProductMapping',
      resourceId: mappingId,
      kind: 'RESERVED',
      quantityDelta: quantity,
      beforeStockQty: txResult.before.stockQty,
      afterStockQty: txResult.after.stockQty,
      beforeReservedQty: txResult.before.reservedQty,
      afterReservedQty: txResult.after.reservedQty,
      reason: 'Reservation created (allocation path)',
      referenceType: 'RESERVATION',
      referenceId: txResult.reservation.id,
      actorId: input.customerId ?? undefined,
      actorRole: input.customerId ? 'CUSTOMER' : 'SYSTEM',
    });

    return {
      id: txResult.reservation.id,
      mappingId: txResult.reservation.mappingId,
      quantity: txResult.reservation.quantity,
      status: txResult.reservation.status,
      orderId: txResult.reservation.orderId,
      expiresAt: txResult.reservation.expiresAt,
    };
  }

  // ── T4.5  Combined allocate + reserve with auto-fallback ───────────────

  /**
   * Allocate the best fulfillment candidate AND reserve stock against it in
   * a single call, with automatic fallback through secondary → tertiary →
   * remaining `allEligible` candidates if a higher-ranked one loses a
   * concurrent reservation race.
   *
   * Why this exists: `allocate()` returns candidates with a snapshot of
   * `available = stockQty - reservedQty`. Between the snapshot and the
   * caller's `reserveStock()` call, another checkout can deplete the
   * primary. Without retry the customer sees a hard "out of stock" even
   * though a perfectly viable secondary candidate exists. With retry the
   * checkout flow self-heals through the ranked list.
   *
   * Only SELLER candidates are attempted here — franchise stock lives in a
   * different table (`FranchiseStock`) with a different reservation flow,
   * so franchise candidates are returned in `allocation.allEligible` but
   * skipped by this method's reservation loop. Callers that need to
   * fulfill via a franchise should use `allocate()` directly and route
   * through the franchise inventory path.
   */
  async allocateAndReserve(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    orderId?: string;
    expiresInMinutes?: number;
    excludeMappingIds?: string[];
    // Phase 77 (2026-05-22) — Phase 52 customerId attribution
    // propagation. Pre-Phase-77 only the 2-step
    // reserveStock path threaded customerId for the stock-ledger
    // forensic trail; switching checkout to allocateAndReserve
    // would have lost that attribution.
    customerId?: string | null;
    sessionId?: string | null;
    cartId?: string | null;
  }): Promise<AllocateAndReserveResult> {
    const {
      productId,
      variantId,
      customerPincode,
      quantity,
      orderId,
      expiresInMinutes,
      excludeMappingIds,
      customerId,
      sessionId,
      cartId,
    } = input;

    const allocation = await this.allocate({
      productId,
      variantId,
      customerPincode,
      quantity,
      excludeMappingIds,
    });

    if (!allocation.serviceable || allocation.allEligible.length === 0) {
      throw new ConflictAppException(
        `No serviceable candidates for product=${productId} pincode=${customerPincode} qty=${quantity}`,
      );
    }

    // Build the attempt list: keep score order (primary first), drop
    // franchise candidates (different reservation table), dedupe by
    // mappingId in case allocate() ever returns duplicates.
    const attemptList: Array<{
      candidate: AllocatedSeller;
      rank: 'primary' | 'secondary' | 'tertiary' | 'fallback';
    }> = [];
    const seen = new Set<string>();
    const tag = (i: number): 'primary' | 'secondary' | 'tertiary' | 'fallback' =>
      i === 0 ? 'primary' : i === 1 ? 'secondary' : i === 2 ? 'tertiary' : 'fallback';
    for (const c of allocation.allEligible) {
      if (c.nodeType !== 'SELLER') continue;
      if (seen.has(c.mappingId)) continue;
      seen.add(c.mappingId);
      // Rank by position among the SELLER candidates we actually attempt — NOT
      // the cross-tier index. With the tiered allEligible (retail→franchise→d2c),
      // a leading FRANCHISE candidate is skipped here, so an `i`-based tag would
      // mislabel the first reservable seller as 'secondary'.
      attemptList.push({ candidate: c, rank: tag(attemptList.length) });
    }

    if (attemptList.length === 0) {
      throw new ConflictAppException(
        `Allocation returned only franchise candidates — caller must use the franchise inventory path`,
      );
    }

    const skippedMappingIds: string[] = [];
    let lastError: Error | null = null;

    for (const { candidate, rank } of attemptList) {
      try {
        const reservation = await this.reserveStock({
          mappingId: candidate.mappingId,
          quantity,
          orderId,
          expiresInMinutes,
          customerId: customerId ?? null,
          sessionId: sessionId ?? null,
          cartId: cartId ?? null,
        });
        if (skippedMappingIds.length > 0) {
          this.logger.warn(
            `allocateAndReserve fell back from ${skippedMappingIds.length} candidate(s) to mapping=${candidate.mappingId} for product=${productId} pincode=${customerPincode}`,
          );
        }
        return {
          allocation,
          reservation,
          chosenCandidate: candidate,
          chosenRank: rank,
          skippedMappingIds,
        };
      } catch (err) {
        // Only ConflictAppException (insufficient stock from a concurrent
        // race) and NotFoundAppException (mapping vanished) are retryable.
        // Anything else — bad input, DB outage, etc. — propagates so we
        // don't paper over real bugs by silently exhausting the list.
        if (
          err instanceof ConflictAppException ||
          err instanceof NotFoundAppException
        ) {
          skippedMappingIds.push(candidate.mappingId);
          lastError = err as Error;
          this.logger.warn(
            `allocateAndReserve: candidate mapping=${candidate.mappingId} (${rank}) lost reservation race: ${(err as Error).message}`,
          );
          continue;
        }
        throw err;
      }
    }

    throw new ConflictAppException(
      `All ${attemptList.length} candidate(s) failed to reserve stock for product=${productId} pincode=${customerPincode} qty=${quantity}. Last error: ${lastError?.message ?? 'unknown'}`,
    );
  }

  // ── T5  Reservation expiry ─────────────────────────────────────────────

  async releaseExpiredReservations(): Promise<number> {
    const now = new Date();

    // Find all expired RESERVED reservations
    const expired = await this.prisma.stockReservation.findMany({
      where: {
        status: 'RESERVED',
        expiresAt: { lt: now },
      },
    });

    if (expired.length === 0) return 0;

    // Process each expired reservation in a transaction. The atomic-claim
    // via updateMany({status: RESERVED}) is the critical guard: this sweep
    // runs on every API instance on a 60s interval, so two instances see
    // the same expired row in their findMany and race here. Without the
    // claim, both would flip the row to EXPIRED and both decrement
    // reservedQty — driving reservedQty below actual held stock. With the
    // claim, only one claim.count === 1 wins; the loser short-circuits.
    let releasedCount = 0;
    for (const reservation of expired) {
      await this.prisma.$transaction(async (tx) => {
        const claim = await tx.stockReservation.updateMany({
          where: { id: reservation.id, status: 'RESERVED' },
          data: { status: 'EXPIRED' },
        });
        if (claim.count === 0) {
          // Another instance won the race — skip the decrement.
          return;
        }

        await tx.sellerProductMapping.update({
          where: { id: reservation.mappingId },
          data: {
            reservedQty: { decrement: reservation.quantity },
          },
        });
        releasedCount++;
      });
    }

    return releasedCount;
  }

  /**
   * Manually release a reservation (e.g. when an order is cancelled).
   */
  async releaseReservation(reservationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) throw new NotFoundAppException(`Reservation ${reservationId} not found`);

      // Atomic claim: only the transaction that flips RESERVED→RELEASED is
      // allowed to decrement reservedQty. A bare read-then-update raced a
      // concurrent release/confirm and double-decremented. count===0 means
      // another path already moved the row off RESERVED — no-op (matches the
      // prior "already released/confirmed" short-circuit).
      const claim = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: 'RESERVED' },
        data: { status: 'RELEASED' },
      });
      if (claim.count === 0) return;

      await tx.sellerProductMapping.update({
        where: { id: reservation.mappingId },
        data: { reservedQty: { decrement: reservation.quantity } },
      });
    });
  }

  /**
   * Phase 69 (2026-05-22) — Phase 68 audit Gap #8. Idempotent
   * "make sure this order item has a live CONFIRMED reservation
   * on the given mapping" — used by the order-verification path
   * to re-reserve stock when the original checkout-time
   * reservation went stale (4-hour-old orders, mapping
   * re-assignment) or was never confirmed (legacy orders).
   *
   * Semantics:
   *   • If an existing CONFIRMED reservation already covers
   *     (orderId, mappingId) with >= quantity units, returns its
   *     id unchanged (no-op).
   *   • Otherwise reserves + confirms fresh on the supplied
   *     mapping. The fresh reservation is returned to the caller
   *     so OrderItem.stockReservationId can be re-pointed.
   *
   * The caller (orders.service.verifyOrder) wraps this in a
   * compensating-cancel block — if any item fails to reserve,
   * the order goes back to PLACED (or CANCELLED if the partial
   * pass already mutated some items).
   */
  async ensureConfirmedReservationAtVerify(input: {
    orderId: string;
    mappingId: string;
    quantity: number;
    customerId?: string | null;
  }): Promise<{ reservationId: string; reused: boolean }> {
    // Look for an existing CONFIRMED reservation on this mapping
    // for this order. The orderId + mappingId + status combo is
    // tight enough that one row should match; if multiples exist
    // (multi-item same-mapping orders), any will do.
    const existing = await this.prisma.stockReservation.findFirst({
      where: {
        orderId: input.orderId,
        mappingId: input.mappingId,
        status: 'CONFIRMED',
        quantity: { gte: input.quantity },
      },
      select: { id: true },
    });
    if (existing) {
      return { reservationId: existing.id, reused: true };
    }
    // Fresh reservation. Pre-Phase-69 a stale order entering
    // verification had no protection — stock could be sniped by
    // a fresh customer between verify and seller-accept. The
    // 15-minute TTL is intentionally short here; the seller is
    // expected to accept within their SLA window and the
    // confirmation makes the deduction permanent.
    const reservation = await this.reserveStock({
      mappingId: input.mappingId,
      quantity: input.quantity,
      orderId: input.orderId,
      expiresInMinutes: 15,
      customerId: input.customerId ?? null,
    });
    await this.confirmReservation(reservation.id, input.orderId);
    return { reservationId: reservation.id, reused: false };
  }

  /**
   * Confirm a reservation (e.g. after payment succeeds).
   */
  async confirmReservation(reservationId: string, orderId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) throw new NotFoundAppException(`Reservation ${reservationId} not found`);

      // Atomic claim: only the transaction that flips RESERVED→CONFIRMED runs
      // the stock deduction. A bare read-then-update let two concurrent confirms
      // of the same reservation both pass the status check and both decrement
      // (silent oversell of real inventory + the shared variant stock).
      const claim = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: 'RESERVED' },
        data: {
          status: 'CONFIRMED',
          orderId: orderId ?? reservation.orderId,
        },
      });
      if (claim.count === 0) {
        // Already moved off RESERVED. Treat a repeat confirm as idempotent;
        // any other terminal state is a genuine conflict.
        const fresh = await tx.stockReservation.findUnique({
          where: { id: reservationId },
          select: { status: true },
        });
        if (fresh?.status === 'CONFIRMED') return;
        throw new ConflictAppException(
          `Reservation ${reservationId} is already ${fresh?.status ?? 'unknown'}`,
        );
      }

      // Deduct from actual stockQty and release reservedQty
      const mapping = await tx.sellerProductMapping.update({
        where: { id: reservation.mappingId },
        data: {
          stockQty: { decrement: reservation.quantity },
          reservedQty: { decrement: reservation.quantity },
        },
      });

      // Also decrement variant/product stock to keep in sync
      if (mapping.variantId) {
        await tx.productVariant.update({
          where: { id: mapping.variantId },
          data: { stock: { decrement: reservation.quantity } },
        });
      } else {
        await tx.product.update({
          where: { id: mapping.productId },
          data: { baseStock: { decrement: reservation.quantity } },
        });
      }
    });
  }

  // ── T6  Fallback re-allocation ─────────────────────────────────────────

  async reallocate(input: {
    orderId: string;
    failedMappingId: string;
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
  }): Promise<AllocationResult> {
    const { orderId, failedMappingId, productId, variantId, customerPincode, quantity } = input;

    // Release any active reservation for the failed mapping + order
    const existingReservations = await this.prisma.stockReservation.findMany({
      where: {
        mappingId: failedMappingId,
        orderId,
        status: 'RESERVED',
      },
    });

    for (const reservation of existingReservations) {
      await this.releaseReservation(reservation.id);
    }

    // Re-run allocation excluding the failed seller. Phase 233 — skipLog so the
    // inner allocate() doesn't write a (LIVE) row; reallocate() writes the one
    // canonical REALLOCATION row below (no double-count).
    const result = await this.allocate({
      productId,
      variantId,
      customerPincode,
      quantity,
      excludeMappingIds: [failedMappingId],
      skipLog: true,
    });

    // Log re-allocation
    if (result.primary) {
      await this.prisma.allocationLog.create({
        data: {
          productId,
          variantId: variantId ?? null,
          customerPincode,
          allocatedNodeType: result.primary.nodeType,
          allocatedSellerId: result.primary.nodeType === 'SELLER' ? result.primary.sellerId : null,
          allocatedFranchiseId: result.primary.nodeType === 'FRANCHISE' ? result.primary.franchiseId : null,
          allocatedMappingId: result.primary.mappingId,
          allocatedPincodeMappingId: result.primary.pincodeMappingId ?? null,
          allocationReason: `Re-allocated from failed mapping ${failedMappingId} (${result.primary.nodeType})`,
          // Phase 233 — fallback outcome: a node was found after the original
          // mapping failed. Tagged REALLOCATION so analytics counts it as a
          // fallback, not a fresh primary.
          eventSource: 'REALLOCATION',
          outcome: 'FALLBACK_SERVICEABLE',
          reasonCode: 'REALLOCATED_FROM_FAILED',
          distanceKm: result.primary.distanceKm,
          score: result.primary.score,
          isReallocated: true,
          orderId,
        },
      });
    } else {
      // Phase 233 — a failed re-allocation (no alternative node) is still a
      // routing event worth recording; pre-233 the inner allocate() logged this
      // as UNSERVICEABLE, so keep that coverage now that the inner write is
      // suppressed.
      await this.prisma.allocationLog.create({
        data: {
          productId,
          variantId: variantId ?? null,
          customerPincode,
          allocationReason: `Re-allocation failed — no alternative to mapping ${failedMappingId}`,
          eventSource: 'REALLOCATION',
          outcome: 'UNSERVICEABLE',
          reasonCode: 'NO_SERVICEABLE_NODE',
          isReallocated: true,
          orderId,
        },
      });
    }

    return result;
  }

  // ── T7  Allocation audit logging ───────────────────────────────────────

  private async logAllocation(
    input: {
      productId: string;
      variantId?: string;
      customerPincode: string;
      // Phase 233 — provenance tag (LIVE default; LISTING/PREVIEW/STOREFRONT
      // from admin/cart callers so they're excluded from checkout analytics).
      eventSource?: AllocationEventSourceTag;
    },
    result: AllocationResult,
  ): Promise<void> {
    const eventSource = input.eventSource ?? 'LIVE';
    try {
      // Phase 77 (2026-05-22) — Phase 76 audit Gap #7. Persist the
      // full ranked candidate list as AllocationCandidate child
      // rows alongside the primary AllocationLog. A later "why
      // was seller X chosen over Y" forensic question can be
      // answered by reading the children, even after stockQty /
      // reservedQty have drifted.
      if (result.primary) {
        await this.prisma.allocationLog.create({
          data: {
            productId: input.productId,
            variantId: input.variantId ?? null,
            customerPincode: input.customerPincode,
            allocatedNodeType: result.primary.nodeType,
            allocatedSellerId: result.primary.nodeType === 'SELLER' ? result.primary.sellerId : null,
            allocatedFranchiseId: result.primary.nodeType === 'FRANCHISE' ? result.primary.franchiseId : null,
            allocatedMappingId: result.primary.mappingId,
            allocatedPincodeMappingId: result.primary.pincodeMappingId ?? null,
            allocationReason: `Primary allocation — highest score (${result.primary.nodeType})`,
            // Phase 233 — provenance + outcome + structured reason. eventSource
            // gates analytics (LIVE/REALLOCATION/MANUAL_REASSIGNMENT count;
            // LISTING/PREVIEW/STOREFRONT don't).
            eventSource,
            outcome: 'PRIMARY_SERVICEABLE',
            reasonCode: 'PRIMARY_HIGHEST_SCORE',
            distanceKm: result.primary.distanceKm,
            score: result.primary.score,
            isReallocated: false,
            candidates: {
              create: (result.allEligible ?? []).map((c, idx) => ({
                rank: idx + 1,
                nodeType: c.nodeType,
                sellerId: c.nodeType === 'SELLER' ? c.sellerId : null,
                franchiseId: c.nodeType === 'FRANCHISE' ? c.franchiseId ?? null : null,
                mappingId: c.mappingId,
                distanceKm: c.distanceKm,
                availableStock: c.availableStock,
                dispatchSla: c.dispatchSla,
                score: c.score,
                excluded: false,
                excludeReason: null,
              })),
            },
          },
        });
      } else {
        await this.prisma.allocationLog.create({
          data: {
            productId: input.productId,
            variantId: input.variantId ?? null,
            customerPincode: input.customerPincode,
            allocationReason: 'No serviceable sellers or franchises found',
            eventSource,
            outcome: 'UNSERVICEABLE',
            reasonCode: 'NO_SERVICEABLE_NODE',
            isReallocated: false,
          },
        });
      }
    } catch (err) {
      // Logging should never break the main flow
      this.logger.error(`Failed to log allocation: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Franchise candidate discovery ──────────────────────────────────────

  /**
   * Find eligible franchise partners for a product (the FRANCHISE tier of the
   * routing cascade). Franchises ship NATIONWIDE — distance is computed
   * (warehousePincode → customer) and fed into the within-tier score so a nearer
   * franchise ranks higher, but there is NO distance cap (a far franchise is
   * never excluded). The franchise tier is only the cascade winner when the
   * retail tier is empty; the returned candidates also serve as the cross-tier
   * fallback chain below retail.
   *
   * A franchise is eligible when:
   *  1. FranchisePartner is ACTIVE/APPROVED, not deleted, not on fulfillment hold
   *  2. FranchiseCatalogMapping exists (approved + active + listed for online),
   *     with variant-or-product-level fallback
   *  3. FranchiseStock has enough available quantity
   *  4. COD: when paymentMethod==='COD', the franchise has codEnabled
   *  5. Territory mode (Phase 159m): if the customer pincode has active
   *     pincode→franchise mappings, ONLY mapped franchises are eligible, ranked
   *     by mapping priority (higher wins); unmapped pincode → all franchises via
   *     distance fallback
   */
  private async findEligibleFranchises(input: {
    productId: string;
    variantId?: string;
    customerPincode: string;
    quantity: number;
    customerLat: number | null;
    customerLon: number | null;
    // Phase 231 — when 'COD', exclude franchises with codEnabled=false.
    paymentMethod?: 'COD' | 'ONLINE';
  }): Promise<AllocatedSeller[]> {
    const {
      productId,
      variantId,
      quantity,
      customerLat,
      customerLon,
      customerPincode,
      paymentMethod,
    } = input;

    // Phase 159m — admin pincode→franchise territory map (supplement mode).
    // If the customer pincode has ≥1 ACTIVE mapping, ONLY those franchises are
    // eligible (and each carries its priority for ranking). If the pincode has
    // no mapping, this map is empty and the legacy distance-based discovery
    // below runs unchanged.
    const pincodeMappingRows =
      await this.prisma.franchisePincodeMapping.findMany({
        where: { pincode: customerPincode, isActive: true },
        select: { id: true, franchiseId: true, priority: true },
      });
    const mappingByFranchise = new Map<
      string,
      { id: string; priority: number }
    >();
    for (const m of pincodeMappingRows) {
      // Same franchise can't have two active rows for one pincode (unique
      // constraint), but guard anyway: keep the higher priority.
      const prev = mappingByFranchise.get(m.franchiseId);
      if (!prev || m.priority > prev.priority) {
        mappingByFranchise.set(m.franchiseId, { id: m.id, priority: m.priority });
      }
    }
    const territoryMode = mappingByFranchise.size > 0;

    // 1. Find all approved + active catalog mappings for this product.
    //    A franchise qualifies if it has either a variant-specific mapping
    //    OR a product-level (variantId=NULL) mapping that implicitly covers
    //    all variants. Variant-specific wins on conflict.
    const catalogWhere: any = {
      productId,
      isActive: true,
      approvalStatus: 'APPROVED',
      isListedForOnlineFulfillment: true,
    };
    if (variantId) {
      catalogWhere.OR = [{ variantId }, { variantId: null }];
    }

    const catalogMappings = await this.prisma.franchiseCatalogMapping.findMany({
      where: catalogWhere,
      include: {
        franchise: {
          select: {
            id: true,
            businessName: true,
            status: true,
            warehousePincode: true,
            isDeleted: true,
            // Phase 230/231 — fulfillment hold, COD capability, and per-franchise
            // dispatch SLA (replaces the hard-coded `dispatchSla = 1`).
            fulfillmentHold: true,
            codEnabled: true,
            dispatchSlaDays: true,
          },
        },
      },
      // Variant-specific rows first so dedup keeps them over product-level fallbacks.
      orderBy: [{ variantId: 'desc' }, { id: 'asc' }],
    });

    const candidates: AllocatedSeller[] = [];

    // Deduplicate by franchiseId (keep first mapping found)
    const seen = new Set<string>();

    // Phase 77 (2026-05-22) — eliminate the N+1 (audit Gaps #9 + #22).
    // Pre-Phase-77 each iteration ran two `franchiseStock.findFirst`
    // queries (variant + wildcard) AND a `postOfficeCache.lookup`
    // inside the loop. The cache helped with pincodes but the
    // FranchiseStock reads were per-iteration. With 50 mappings ⇒
    // 100 sequential DB round-trips. Now: two batched findMany
    // queries before the loop, then in-memory lookup.
    const operationalMappings = catalogMappings.filter((m) => {
      const f = m.franchise;
      return (
        (f.status === 'ACTIVE' || f.status === 'APPROVED') &&
        !f.isDeleted &&
        // Phase 230 — exclude franchises on a manual fulfillment hold.
        !f.fulfillmentHold &&
        // Phase 231 — exclude franchises that don't accept COD for a COD order.
        (paymentMethod !== 'COD' || f.codEnabled) &&
        // Phase 159m — territory enforcement: when the pincode has mappings,
        // only mapped franchises are eligible. Unmapped pincode → all pass.
        (!territoryMode || mappingByFranchise.has(f.id)) &&
        !seen.has(f.id) &&
        seen.add(f.id) // sneaky: returns the Set, truthy
      );
    });
    const franchiseIds = operationalMappings.map((m) => m.franchise.id);

    // Batch fetch all candidate stock rows (variant-specific +
    // product-level wildcards together; the lookup map keys
    // resolve the precedence).
    const stockRows = franchiseIds.length
      ? await this.prisma.franchiseStock.findMany({
          where: {
            franchiseId: { in: franchiseIds },
            productId,
            OR: variantId
              ? [{ variantId }, { variantId: null }]
              : [{ variantId: null }],
          },
        })
      : [];
    // Build lookup: prefer variant-specific over wildcard for each
    // franchise. variant-specific rows are processed second so
    // they overwrite the wildcard entry — the map's final value
    // wins.
    const stockByFranchise = new Map<string, (typeof stockRows)[number]>();
    for (const s of stockRows.filter((s) => s.variantId === null)) {
      stockByFranchise.set(s.franchiseId, s);
    }
    if (variantId) {
      for (const s of stockRows.filter((s) => s.variantId === variantId)) {
        stockByFranchise.set(s.franchiseId, s);
      }
    }

    // Batch fetch warehouse pincode coords. Unique pincodes only —
    // the cache `lookupMany` is itself batched to a single
    // findMany if any miss the L1 cache.
    const warehousePincodes = Array.from(
      new Set(
        operationalMappings
          .map((m) => m.franchise.warehousePincode)
          .filter((p): p is string => !!p),
      ),
    );
    const warehouseCoordsMap = new Map<
      string,
      { latitude: number | null; longitude: number | null }
    >();
    await Promise.all(
      warehousePincodes.map(async (p) => {
        const coords = await this.postOfficeCache.lookup(p);
        warehouseCoordsMap.set(p, {
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        });
      }),
    );

    for (const mapping of operationalMappings) {
      const franchise = mapping.franchise;
      const stock = stockByFranchise.get(franchise.id);
      if (!stock || stock.availableQty < quantity) continue;

      // Calculate distance from franchise warehouse pincode to customer pincode.
      // Explicit null checks so a 0-axis customer coord isn't treated as missing
      // (franchise is nationwide so this only affects the distance score, but we
      // keep it consistent with the seller path).
      let distance: number | null = null;
      if (customerLat != null && customerLon != null && franchise.warehousePincode) {
        const coords = warehouseCoordsMap.get(franchise.warehousePincode);
        if (coords?.latitude != null && coords?.longitude != null) {
          distance = this.calculateDistance(
            customerLat,
            customerLon,
            coords.latitude,
            coords.longitude,
          );
        }
      }

      // Tiered cascade (2026-06-16) — Franchises ship NATIONWIDE: no distance
      // cap. (Pre-cascade this mirrored the seller 1500km cap.) Distance is
      // still computed and fed into the within-tier score so a nearer franchise
      // still outranks a far one, but a far franchise is never excluded.

      // Phase 231 — per-franchise dispatch SLA (was hard-coded 1, which made
      // the SLA score term meaningless for franchises). Default 1 preserves the
      // exact pre-231 ranking for franchises that never set it.
      const dispatchSla = franchise.dispatchSlaDays ?? 1;
      const territory = mappingByFranchise.get(franchise.id);

      candidates.push({
        nodeType: 'FRANCHISE',
        tier: 'FRANCHISE',
        sellerId: franchise.id,
        sellerName: franchise.businessName,
        franchiseId: franchise.id,
        mappingId: mapping.id,
        distanceKm: distance !== null ? Math.round(distance * 100) / 100 : null,
        dispatchSla,
        availableStock: stock.availableQty,
        estimatedDeliveryDays: this.estimateDeliveryDays(distance ?? 0, dispatchSla),
        score: 0,
        // Phase 159m — territory mapping snapshot + priority (set only when the
        // pincode had an active mapping for this franchise).
        pincodeMappingId: territory?.id,
        mappingPriority: territory?.priority,
        pickupPincode: franchise.warehousePincode ?? null,
        // Phase 231/232 — explainability for the routing-preview UI.
        reasons: [
          territory
            ? `territory-mapped (priority ${territory.priority})`
            : 'distance-coverage',
          `stock-ok (${stock.availableQty} avail)`,
          distance !== null
            ? `distance ${Math.round(distance * 100) / 100}km`
            : 'distance-unknown',
          `dispatch-sla ${dispatchSla}d`,
        ],
      });
    }

    return candidates;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private estimateDeliveryDays(distanceKm: number, dispatchSla: number): number {
    let transitDays = 1;
    if (distanceKm > 500) transitDays = 4;
    else if (distanceKm > 200) transitDays = 3;
    else if (distanceKm > 50) transitDays = 2;
    return dispatchSla + transitDays;
  }
}
