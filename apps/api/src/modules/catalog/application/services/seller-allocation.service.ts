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
  }

  // ── T1-T2  Core allocation ─────────────────────────────────────────────

  /**
   * Allocates the best fulfillment node(s) — sellers and/or franchises —
   * for a product/variant at a customer pincode.
   * Returns primary, secondary, and tertiary candidates.
   *
   * Ranking criteria (weighted scoring — sellers & franchises compete equally):
   *  - Distance: ROUTING_DISTANCE_WEIGHT (default 0.7, lower = better, Haversine from pincode)
   *  - Stock confidence: ROUTING_STOCK_WEIGHT (default 0.2, more stock = better)
   *  - Dispatch SLA: ROUTING_SLA_WEIGHT (default 0.1, faster = better)
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

    // 3. Filter by distance — seller must be within serviceable range
    // Phase 64 — distance is nullable for no-coords mappings
    // (audit Gap #9). They still compete for selection but are
    // excluded from the distance score.
    const serviceable: {
      mapping: (typeof eligible)[number];
      distance: number | null;
    }[] = [];

    // Phase 4 follow-up (2026-05-16) — batch-prefetch coordinates
    // for every candidate seller mapping that lacks cached lat/lon
    // but does have a pickupPincode. One round-trip through the
    // cache (mostly hits) + at most one Postgres query for misses,
    // instead of N sequential findFirst calls inside the scoring loop.
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

    for (const mapping of eligible) {
      let distance: number | null = null;
      let sellerLat = mapping.latitude ? Number(mapping.latitude) : null;
      let sellerLon = mapping.longitude ? Number(mapping.longitude) : null;

      // If mapping has no coordinates but has pickupPincode, use the
      // pre-fetched cache result populated above.
      if ((sellerLat == null || sellerLon == null) && mapping.pickupPincode) {
        const sellerCoords = pincodeCoords.get(mapping.pickupPincode);
        if (sellerCoords?.latitude != null && sellerCoords?.longitude != null) {
          sellerLat = sellerCoords.latitude;
          sellerLon = sellerCoords.longitude;
        }
      }

      if (customerLat && customerLon && sellerLat && sellerLon) {
        distance = this.calculateDistance(customerLat, customerLon, sellerLat, sellerLon);
      }

      // Phase 64 (audit Gaps #8 + #9). Two behaviour changes:
      //   - Max distance cap: a mapping resolved > maxDistanceKm
      //     away is filtered out as unserviceable. Pre-Phase-64
      //     the cap didn't exist and the allocator would happily
      //     route a Chennai customer to a 2500km Punjab seller.
      //   - No-coords mappings are now distinctly tracked with
      //     distance=null instead of the synthetic 999 placeholder.
      //     They still compete for selection but are excluded from
      //     the distance score (the score's distance term becomes
      //     0 for them) so a 200km seller correctly outranks a
      //     no-coords seller.
      if (distance !== null && this.maxDistanceKm > 0 && distance > this.maxDistanceKm) {
        continue; // filtered out
      }
      serviceable.push({ mapping, distance });
    }

    // 4. Build seller candidates with nodeType
    const sellerCandidates: AllocatedSeller[] = serviceable.map((s) => {
      const avail = s.mapping.stockQty - s.mapping.reservedQty;
      // Phase 230 — wire operationalPriority (the "manual preferred seller"
      // lever) into ranking. It was a dead column pre-230: declared on the
      // mapping but never read by scoring. >0 only (default 0 => undefined =>
      // no score effect => no regression for sellers that never set it).
      const priority =
        s.mapping.operationalPriority > 0
          ? s.mapping.operationalPriority
          : undefined;
      return {
        nodeType: 'SELLER' as const,
        sellerId: s.mapping.seller.id,
        sellerName: s.mapping.seller.sellerShopName || s.mapping.seller.sellerName,
        mappingId: s.mapping.id,
        distanceKm: s.distance !== null ? Math.round(s.distance * 100) / 100 : null,
        dispatchSla: s.mapping.dispatchSla,
        availableStock: avail,
        // Phase 64 — unknown distance falls back to "0 km transit" so
        // the SLA-only estimate is the floor. This was effectively
        // the pre-Phase-64 behaviour for the 999-placeholder case;
        // we preserve it for the null-distance case.
        estimatedDeliveryDays: this.estimateDeliveryDays(s.distance ?? 0, s.mapping.dispatchSla),
        score: 0, // will be scored below
        mappingPriority: priority,
        // Phase 231/232 — explainability (rendered by routing-preview UI).
        reasons: [
          optedInSellers.has(s.mapping.seller.id)
            ? 'within-service-area'
            : 'distance-coverage',
          `stock-ok (${avail} avail)`,
          s.distance !== null
            ? `distance ${Math.round(s.distance * 100) / 100}km`
            : 'distance-unknown',
          ...(priority !== undefined ? [`priority ${priority}`] : []),
        ],
      };
    });

    // 5. Find franchise candidates — same distance-based logic as sellers
    const franchiseCandidates = await this.findEligibleFranchises({
      productId,
      variantId,
      customerPincode,
      quantity,
      customerLat,
      customerLon,
      paymentMethod,
    });

    // 6. Merge all candidates (sellers + franchises compete equally)
    const allCandidates = [
      ...sellerCandidates,
      ...franchiseCandidates,
    ];

    if (allCandidates.length === 0) {
      // Phase 64 (audit Gap #16) — diagnose WHY there are no
      // candidates. We approximate by re-running the cheap
      // exclusion filters: if mappings existed but were filtered
      // by stock, surface OUT_OF_STOCK; if they were filtered by
      // service-area opt-in, surface NO_SERVICE_AREA; otherwise
      // NO_MAPPING. The distance-cap path doesn't carry context
      // through here, so DISTANCE_EXCEEDED is surfaced only when
      // we have evidence: candidates existed pre-distance-filter.
      let reason: ServiceabilityReason = 'NO_MAPPING';
      if (sellerMappings.length > 0) {
        // Mappings exist for the product but were filtered out.
        const seller0 = sellerMappings[0];
        if (seller0 && seller0.seller.status !== 'ACTIVE') {
          reason = 'NO_MAPPING';
        } else if (stockEligible.length === 0) {
          reason = 'OUT_OF_STOCK';
        } else if (eligible.length === 0) {
          reason = 'NO_SERVICE_AREA';
        } else {
          // Stock + service area passed, so all candidates must
          // have been filtered by the distance cap.
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

    // Phase 64 (audit Gap #9) — distances may be null when a
    // candidate had no coordinates. Use the max of known distances
    // for normalization; null-distance candidates get a 0 distance
    // score component (don't contribute to or benefit from
    // distance ranking).
    const knownDistances = allCandidates
      .map((c) => c.distanceKm)
      .filter((d): d is number => d !== null);
    const maxDistance = knownDistances.length > 0 ? Math.max(...knownDistances, 1) : 1;
    const maxSla = Math.max(...allCandidates.map((c) => c.dispatchSla), 1);

    const scored: AllocatedSeller[] = allCandidates.map((candidate) => {
      let score = 0;
      // Distance score (lower distance = higher score). Null
      // distance contributes 0 to this term — a no-coords
      // candidate doesn't get credit for being "closer" than a
      // real candidate.
      if (candidate.distanceKm !== null) {
        score += this.wDistance * (1 - candidate.distanceKm / maxDistance);
      }
      // Stock confidence
      score += this.wStock * Math.min(candidate.availableStock / quantity, 1);
      // SLA score (faster dispatch = higher score)
      score += this.wSla * (1 - candidate.dispatchSla / maxSla);
      // Phase 159m — admin pincode→franchise territory priority. Only set for
      // franchise candidates chosen via an active mapping (else undefined → no
      // effect), so unmapped routing is unchanged. Higher priority (0..1000)
      // ranks a franchise above a lower-priority one serving the same pincode.
      if (candidate.mappingPriority != null) {
        score += this.wPincodePriority * (candidate.mappingPriority / 1000);
      }
      return { ...candidate, score: Math.round(score * 10000) / 10000 };
    });

    // 7. Sort by score descending — highest score wins.
    //
    // Phase 77 (2026-05-22) — explicit secondary key on equal score
    // (audit Gap #13). Pre-Phase-77 we relied on stable sort + the
    // input `orderBy` to break ties; that's deterministic in a
    // single replica but two replicas can read with subtly
    // different ordering under concurrent writes. Adding the
    // mappingId tiebreak removes the race-window entirely.
    scored.sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      // Lexicographic on mappingId — every candidate has one, so
      // this is a total ordering. nullish-safe (no candidate has a
      // null mappingId at this stage).
      const am = a.mappingId ?? '';
      const bm = b.mappingId ?? '';
      return am < bm ? -1 : am > bm ? 1 : 0;
    });

    const result: AllocationResult = {
      serviceable: true,
      reason: 'OK',
      primary: scored[0] ?? null,
      secondary: scored[1] ?? null,
      tertiary: scored[2] ?? null,
      allEligible: scored,
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
  }): Promise<AllocationResult> {
    // The allocate() call already wraps the logAllocation in a
    // catch-all so a logging miss won't propagate; but for a
    // preview we'd rather skip the write entirely. Inline a thin
    // copy by temporarily NO-OPing the writer. Cleaner than a
    // boolean flag in the hot path.
    const originalLog = this.logAllocation.bind(this);
    (this as any).logAllocation = async () => undefined;
    try {
      return await this.allocate(input);
    } finally {
      (this as any).logAllocation = originalLog;
    }
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
        Array<{ id: string; stock_qty: number; reserved_qty: number }>
      >`
        SELECT id, stock_qty, reserved_qty
        FROM seller_product_mappings
        WHERE id = ${mappingId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
      }

      const available = locked.stock_qty - locked.reserved_qty;
      if (available < quantity) {
        throw new ConflictAppException(
          `Insufficient stock: available=${available}, requested=${quantity}`,
        );
      }

      const mapping = await tx.sellerProductMapping.findUnique({
        where: { id: mappingId },
      });
      if (!mapping) {
        throw new NotFoundAppException(`Mapping ${mappingId} not found`);
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
    for (let i = 0; i < allocation.allEligible.length; i++) {
      const c = allocation.allEligible[i]!;

      if (c.nodeType !== 'SELLER') continue;
      if (seen.has(c.mappingId)) continue;
      seen.add(c.mappingId);
      attemptList.push({ candidate: c, rank: tag(i) });
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
      if (reservation.status !== 'RESERVED') return; // already released/confirmed

      await tx.stockReservation.update({
        where: { id: reservationId },
        data: { status: 'RELEASED' },
      });

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
      if (reservation.status !== 'RESERVED') {
        throw new ConflictAppException(`Reservation ${reservationId} is already ${reservation.status}`);
      }

      await tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          status: 'CONFIRMED',
          orderId: orderId ?? reservation.orderId,
        },
      });

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
   * Find eligible franchise partners for a product, using the same
   * distance-based logic as sellers. Franchises compete equally with
   * sellers — no coverage area checks, no exclusivity, no priority boost.
   *
   * A franchise is eligible when:
   *  1. FranchisePartner status is ACTIVE
   *  2. FranchiseCatalogMapping exists (approved + active + listed for online)
   *  3. FranchiseStock has enough available quantity
   *  4. Distance is calculated from franchise warehousePincode to customer pincode
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

      // Calculate distance from franchise warehouse pincode to customer pincode
      let distance: number | null = null;
      if (customerLat && customerLon && franchise.warehousePincode) {
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

      // Phase 77 — apply the same max-distance cap as the seller
      // path so a franchise warehouse 2500km away is also excluded.
      if (distance !== null && this.maxDistanceKm > 0 && distance > this.maxDistanceKm) {
        continue;
      }

      // Phase 231 — per-franchise dispatch SLA (was hard-coded 1, which made
      // the SLA score term meaningless for franchises). Default 1 preserves the
      // exact pre-231 ranking for franchises that never set it.
      const dispatchSla = franchise.dispatchSlaDays ?? 1;
      const territory = mappingByFranchise.get(franchise.id);

      candidates.push({
        nodeType: 'FRANCHISE',
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
