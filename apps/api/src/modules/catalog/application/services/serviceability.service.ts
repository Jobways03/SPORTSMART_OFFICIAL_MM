import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';

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

function pickClosestSource(
  sellers: ServiceableSeller[],
  franchises: ServiceableFranchise[],
): { distance: number | null; estimatedDeliveryDays: number } | null {
  const candidates: { distance: number | null; estimatedDeliveryDays: number }[] = [
    ...sellers.map((s) => ({
      distance: s.distance,
      estimatedDeliveryDays: s.estimatedDeliveryDays,
    })),
    ...franchises.map((f) => ({
      distance: f.distance,
      estimatedDeliveryDays: f.estimatedDeliveryDays,
    })),
  ];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.distance === null && b.distance === null) return 0;
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  });
  return candidates[0];
}

@Injectable()
export class ServiceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if a product/variant can be delivered to a pincode.
   * Returns serviceable sellers sorted by distance ASC with delivery estimates.
   */
  async checkServiceability(
    productId: string,
    variantId: string | null,
    customerPincode: string,
  ): Promise<ServiceabilityResult> {
    if (!productId) {
      throw new BadRequestAppException('productId is required');
    }
    if (!customerPincode) {
      throw new BadRequestAppException('pincode is required');
    }

    // 1. Get customer pincode coordinates from PostOffice table
    const customerLocation = await this.prisma.postOffice.findFirst({
      where: { pincode: customerPincode, latitude: { not: null } },
      select: { latitude: true, longitude: true, district: true, state: true },
    });

    // 2. Find all active seller mappings for this product/variant with stock > 0
    const mappingWhere: any = {
      productId,
      isActive: true,
      approvalStatus: 'APPROVED',
      stockQty: { gt: 0 },
    };

    if (variantId) {
      mappingWhere.variantId = variantId;
    }

    const sellerMappings = await this.prisma.sellerProductMapping.findMany({
      where: mappingWhere,
      include: {
        seller: {
          select: {
            id: true,
            sellerName: true,
            sellerShopName: true,
            status: true,
          },
        },
      },
      orderBy: { operationalPriority: 'desc' },
    });

    // Filter only ACTIVE sellers
    const activeMappings = sellerMappings.filter(
      (m) => m.seller.status === 'ACTIVE',
    );

    const customerLat = customerLocation?.latitude
      ? Number(customerLocation.latitude)
      : null;
    const customerLon = customerLocation?.longitude
      ? Number(customerLocation.longitude)
      : null;

    // 3. For each seller mapping, check serviceability
    const serviceableSellers: ServiceableSeller[] = [];

    for (const mapping of activeMappings) {
      const seller = mapping.seller;

      let distance: number | null = null;

      // Calculate distance using seller's pickup pincode coordinates
      const sellerLat = mapping.latitude ? Number(mapping.latitude) : null;
      const sellerLon = mapping.longitude ? Number(mapping.longitude) : null;

      if (customerLat && customerLon && sellerLat && sellerLon) {
        distance = this.calculateDistance(
          customerLat,
          customerLon,
          sellerLat,
          sellerLon,
        );
      }

      // All sellers with stock are serviceable — distance determines ranking
      {
        const estimatedDays = this.estimateDeliveryDays(
          distance ?? 0,
          mapping.dispatchSla,
        );

        serviceableSellers.push({
          sellerId: seller.id,
          sellerName: seller.sellerShopName || seller.sellerName,
          distance: distance !== null ? Math.round(distance * 100) / 100 : null,
          dispatchSla: mapping.dispatchSla,
          stockQty: mapping.stockQty,
          estimatedDeliveryDays: estimatedDays,
        });
      }
    }

    // 4. Sort sellers by distance ASC (null distances go last)
    serviceableSellers.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

    // 5. Find serviceable franchises that stock this product
    const serviceableFranchises = await this.findServiceableFranchises(
      productId,
      variantId,
      customerLat,
      customerLon,
    );

    // 6. Build response
    const isServiceable =
      serviceableSellers.length > 0 || serviceableFranchises.length > 0;

    // Pick the closest fulfillment source (seller or franchise) for the
    // headline delivery estimate so the customer sees the best available SLA.
    const bestSource = pickClosestSource(
      serviceableSellers,
      serviceableFranchises,
    );

    let deliveryEstimate: string | null = null;
    let estimatedDays: number | null = null;

    if (bestSource) {
      estimatedDays = bestSource.estimatedDeliveryDays;
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
      serviceable: isServiceable,
      sellers: serviceableSellers,
      franchises: serviceableFranchises,
      deliveryEstimate,
      estimatedDays,
    };
  }

  /**
   * Find serviceable franchises for the product. Mirrors the eligibility
   * gates used by SellerAllocationService.findEligibleFranchises so the
   * storefront pincode checker shows the same fulfillment sources the
   * order router will actually pick from.
   */
  private async findServiceableFranchises(
    productId: string,
    variantId: string | null,
    customerLat: number | null,
    customerLon: number | null,
  ): Promise<ServiceableFranchise[]> {
    // A franchise qualifies if it has either a variant-specific mapping
    // OR a product-level (variantId=NULL) mapping that implicitly covers
    // all variants. Variant-specific wins on conflict.
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
          },
        },
      },
      // Variant-specific first so dedup keeps it over product-level fallback.
      orderBy: [{ variantId: 'desc' }, { id: 'asc' }],
    });

    const out: ServiceableFranchise[] = [];
    const seen = new Set<string>();

    for (const mapping of catalogMappings) {
      const franchise = mapping.franchise;
      // Operational = ACTIVE or APPROVED. Matches procurement.service precedent.
      const operational =
        franchise.status === 'ACTIVE' || franchise.status === 'APPROVED';
      if (!operational || franchise.isDeleted) continue;
      if (seen.has(franchise.id)) continue;
      seen.add(franchise.id);

      // Try variant-specific stock row first, then product-level fallback.
      let stock = null as Awaited<ReturnType<typeof this.prisma.franchiseStock.findFirst>>;
      if (variantId) {
        stock = await this.prisma.franchiseStock.findFirst({
          where: { franchiseId: franchise.id, productId, variantId },
        });
      }
      if (!stock) {
        stock = await this.prisma.franchiseStock.findFirst({
          where: { franchiseId: franchise.id, productId, variantId: null },
        });
      }
      if (!stock || stock.availableQty <= 0) continue;

      let distance: number | null = null;
      if (customerLat && customerLon && franchise.warehousePincode) {
        const warehousePO = await this.prisma.postOffice.findFirst({
          where: {
            pincode: franchise.warehousePincode,
            latitude: { not: null },
          },
          select: { latitude: true, longitude: true },
        });
        if (warehousePO?.latitude && warehousePO?.longitude) {
          distance = this.calculateDistance(
            customerLat,
            customerLon,
            Number(warehousePO.latitude),
            Number(warehousePO.longitude),
          );
        }
      }

      const dispatchSla = 1; // franchise default dispatch SLA
      out.push({
        franchiseId: franchise.id,
        franchiseName: franchise.businessName,
        distance:
          distance !== null ? Math.round(distance * 100) / 100 : null,
        dispatchSla,
        stockQty: stock.availableQty,
        estimatedDeliveryDays: this.estimateDeliveryDays(
          distance ?? 0,
          dispatchSla,
        ),
      });
    }

    out.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

    return out;
  }

  /**
   * Haversine distance calculation (km)
   */
  calculateDistance(
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

  /**
   * Estimate delivery days based on distance + dispatch SLA.
   * dispatch SLA + transit time
   */
  private estimateDeliveryDays(distanceKm: number, dispatchSla: number): number {
    let transitDays = 1;
    if (distanceKm > 500) transitDays = 4;
    else if (distanceKm > 200) transitDays = 3;
    else if (distanceKm > 50) transitDays = 2;
    return dispatchSla + transitDays;
  }
}
