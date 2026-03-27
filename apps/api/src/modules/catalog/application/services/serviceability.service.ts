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

interface ServiceabilityResult {
  serviceable: boolean;
  sellers: ServiceableSeller[];
  deliveryEstimate: string | null;
  estimatedDays: number | null;
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

    if (activeMappings.length === 0) {
      return {
        serviceable: false,
        sellers: [],
        deliveryEstimate: null,
        estimatedDays: null,
      };
    }

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

    // 6. Sort by distance ASC (null distances go last)
    serviceableSellers.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

    // 7. Build response
    const isServiceable = serviceableSellers.length > 0;
    const bestSeller = serviceableSellers[0] ?? null;

    let deliveryEstimate: string | null = null;
    let estimatedDays: number | null = null;

    if (bestSeller) {
      estimatedDays = bestSeller.estimatedDeliveryDays;
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
      deliveryEstimate,
      estimatedDays,
    };
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
