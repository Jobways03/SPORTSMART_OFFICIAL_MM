import { Injectable, Optional } from '@nestjs/common';
import { SellerAllocationService } from './seller-allocation.service';
import { LogisticsFacadeClient } from '../../../../integrations/logistics-facade/clients/logistics-facade.client';

interface ServiceableSeller {
  sellerId: string;
  sellerName: string;
  distance: number | null;
  dispatchSla: number;
  stockQty: number;
  estimatedDeliveryDays: number;
}

interface ServiceableFranchise {
  franchiseId: string;
  franchiseName: string;
  distance: number | null;
  dispatchSla: number;
  stockQty: number;
  estimatedDeliveryDays: number;
}

interface ServiceabilityResult {
  serviceable: boolean;
  sellers: ServiceableSeller[];
  franchises: ServiceableFranchise[];
  deliveryEstimate: string | null;
  estimatedDays: number | null;
}

/**
 * Phase 64 (2026-05-22) — thin wrapper over SellerAllocationService
 * (audit Gap #5).
 *
 * Pre-Phase-64 this service had its OWN serviceability rules:
 *   - Ignored SellerServiceArea opt-in entirely — sellers with
 *     explicit area rows still showed up at every pincode.
 *   - Reported raw stockQty instead of (stockQty - reservedQty),
 *     so the PDP showed "in stock" while concurrent checkouts had
 *     already reserved the units.
 *   - No distance cap.
 *   - Didn't dedup mappings.
 * The cart-side allocator (SellerAllocationService) had a stricter
 * ruleset, so customers saw "deliverable" on PDP and
 * "unserviceable" at checkout for the same pincode — the audit's
 * top customer-facing UX bug.
 *
 * Phase 64 deletes the divergent logic and delegates to the
 * allocator's new `previewServiceability` method, then projects
 * the result into the legacy ServiceableResult shape so existing
 * callers (StorefrontServiceabilityController + tests) keep
 * working.
 */
@Injectable()
export class ServiceabilityService {
  constructor(
    private readonly allocation: SellerAllocationService,
    // Phase 4 Delhivery wiring (2026-06-02) — real courier serviceability.
    // @Optional so existing unit tests (which construct with allocation
    // only) keep working; when unwired, the courier check is skipped.
    @Optional() private readonly facade?: LogisticsFacadeClient,
  ) {}

  /**
   * Best-effort real Delhivery drop-pincode serviceability. Returns true
   * when we CAN'T determine it (facade unwired / error / non-boolean) so a
   * carrier hiccup never wrongly blocks an otherwise-serviceable product.
   * Only the explicit `serviceable: false` from Delhivery blocks.
   */
  private async delhiveryServiceable(pincode: string): Promise<boolean> {
    if (!this.facade) return true;
    try {
      const res = await this.facade.get<any>(
        `/api/v1/internal/delhivery/serviceability/${encodeURIComponent(pincode)}`,
      );
      const d = res?.body && (res.body.data ?? res.body);
      if (res.status >= 200 && res.status < 300 && typeof d?.serviceable === 'boolean') {
        return d.serviceable;
      }
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Check if a product/variant can be delivered to a pincode.
   * Returns the legacy ServiceabilityResult shape projected from
   * the canonical allocator preview.
   */
  async checkServiceability(
    productId: string,
    variantId: string | null,
    customerPincode: string,
  ): Promise<ServiceabilityResult> {
    const allocation = await this.allocation.previewServiceability({
      productId,
      variantId: variantId ?? undefined,
      customerPincode,
      quantity: 1,
    });

    // Phase 4 Delhivery wiring — a product is only deliverable if a node can
    // fulfil it AND Delhivery actually services the drop pincode. Only query
    // the carrier when there's a fulfilment node (saves a Delhivery call when
    // the answer is already "no").
    const serviceable = allocation.serviceable
      ? await this.delhiveryServiceable(customerPincode)
      : false;

    // Phase 64 — project from the allocator's AllocatedSeller[]
    // into the legacy ServiceableSeller / ServiceableFranchise
    // shape the storefront UI expects. The sanitised public
    // controller (Phase 64) only surfaces counts + delivery
    // estimate; this richer shape is also exposed via the cart
    // preview endpoint where the customer is authenticated.
    const sellers: ServiceableSeller[] = [];
    const franchises: ServiceableFranchise[] = [];

    for (const cand of allocation.allEligible) {
      if (cand.nodeType === 'SELLER') {
        sellers.push({
          sellerId: cand.sellerId,
          sellerName: cand.sellerName,
          distance: cand.distanceKm,
          dispatchSla: cand.dispatchSla,
          // `availableStock` from the allocator is the
          // post-reservation figure (stockQty - reservedQty),
          // which is what we want to show on the PDP — the raw
          // stockQty pre-Phase-64 over-reported availability.
          stockQty: cand.availableStock,
          estimatedDeliveryDays: cand.estimatedDeliveryDays,
        });
      } else {
        franchises.push({
          franchiseId: cand.sellerId,
          franchiseName: cand.sellerName,
          distance: cand.distanceKm,
          dispatchSla: cand.dispatchSla,
          stockQty: cand.availableStock,
          estimatedDeliveryDays: cand.estimatedDeliveryDays,
        });
      }
    }

    // Sort by distance ASC (null last) — same as pre-Phase-64.
    const byDistance = <T extends { distance: number | null }>(a: T, b: T) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    };
    sellers.sort(byDistance);
    franchises.sort(byDistance);

    // Pick the closest fulfilment source for the headline estimate.
    const allByDistance = [...sellers, ...franchises].sort(byDistance);
    const best = allByDistance[0];
    let deliveryEstimate: string | null = null;
    let estimatedDays: number | null = null;
    if (best) {
      estimatedDays = best.estimatedDeliveryDays;
      if (estimatedDays <= 1) {
        deliveryEstimate = 'Delivery by tomorrow';
      } else if (estimatedDays <= 3) {
        deliveryEstimate = `Delivery in ${estimatedDays} days`;
      } else if (estimatedDays <= 5) {
        deliveryEstimate = `Delivery in ${estimatedDays}-${estimatedDays + 1} days`;
      } else {
        deliveryEstimate = `Delivery in ${estimatedDays}-${estimatedDays + 2} days`;
      }
    }

    return {
      serviceable,
      sellers,
      franchises,
      deliveryEstimate,
      estimatedDays,
    };
  }
}
