import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../../core/guards';
import {
  AllocateAndReserveDto,
  AllocateRequestDto,
  ConfirmRequestDto,
  ReallocateRequestDto,
  ReleaseRequestDto,
  ReserveRequestDto,
} from '../../dtos/storefront-allocation.dto';
import {
  AllocationResult,
  SellerAllocationService,
} from '../../../application/services/seller-allocation.service';

/**
 * Phase 64 (2026-05-22) — allocation controller hardening.
 *
 * Pre-Phase-64 EVERY endpoint here was public, no auth, no rate
 * limit (audit Gap #1). The /allocate/reserve in particular let an
 * anonymous attacker reserve a competitor's stock for 15 minutes
 * by guessing a mappingId — and the /allocate response carried
 * mappingIds back so they didn't even need to guess.
 *
 * The Phase 64 surface:
 *   - @UseGuards(UserAuthGuard) on the entire controller —
 *     anonymous callers get a 401 instead of a free reservation
 *     primitive.
 *   - @Throttle on every mutation; the read endpoint has a more
 *     permissive cap so authenticated customers shopping their
 *     cart aren't blocked.
 *   - DTOs validate UUIDs + pincode pattern + array size at the
 *     pipe layer (audit Gap #21).
 *
 * Note: anonymous users still have the PDP path via
 * /storefront/serviceability/check (rate-limited + sanitised in
 * Phase 64). They no longer have a way to call the reservation
 * primitives directly.
 */
@ApiTags('Storefront')
@Controller('storefront/allocate')
@UseGuards(UserAuthGuard)
export class StorefrontAllocationController {
  constructor(
    private readonly allocationService: SellerAllocationService,
  ) {}

  /**
   * POST /storefront/allocate
   * Pre-allocation: returns ranked sellers for each item at a customer pincode.
   * Authenticated customers only.
   */
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async allocate(@Body() body: AllocateRequestDto) {
    const results: {
      productId: string;
      variantId: string | null;
      quantity: number;
      allocation: AllocationResult;
    }[] = [];

    // Phase 64 (audit Gap #6) — parallelize the per-item allocator
    // calls so a 50-item POST doesn't block the cluster for ~5
    // seconds. Order preserved via Promise.all index alignment.
    const allocations = await Promise.all(
      body.items.map((item) =>
        this.allocationService.allocate({
          productId: item.productId,
          variantId: item.variantId,
          customerPincode: body.customerPincode,
          quantity: item.quantity,
        }),
      ),
    );

    body.items.forEach((item, idx) => {
      results.push({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        allocation: allocations[idx]!,
      });
    });

    const allServiceable = results.every((r) => r.allocation.serviceable);

    // Phase 77 (2026-05-22) — audit Gap #20 + Flow #49 carry. The
    // customer-facing surface receives ONLY the fields they need to
    // render the cart serviceability state. mappingId / sellerId /
    // sellerName / availableStock / score / dispatchSla are internal
    // ranking metadata — a scraper with a logged-in account could
    // otherwise build a competitive-intelligence map (which seller
    // is nearest to each pincode, what stock depth each carries).
    //
    // estimatedDeliveryDays + the seller's *display name* stay
    // because they're already visible on order detail; everything
    // else is stripped.
    const sanitisePrimary = (p: any) =>
      p
        ? {
            nodeType: p.nodeType,
            // Display name is OK (it's already on order detail);
            // sellerId / mappingId / score are not.
            sellerName: p.sellerName,
            estimatedDeliveryDays: p.estimatedDeliveryDays,
          }
        : null;

    return {
      success: true,
      message: allServiceable
        ? 'All items are serviceable'
        : 'Some items are not serviceable at this pincode',
      data: {
        allServiceable,
        customerPincode: body.customerPincode,
        items: results.map((r) => ({
          productId: r.productId,
          variantId: r.variantId,
          quantity: r.quantity,
          serviceable: r.allocation.serviceable,
          // Customer needs the unserviceable reason to act on it.
          unserviceableReason: !r.allocation.serviceable
            ? r.allocation.reason ?? null
            : null,
          primary: sanitisePrimary(r.allocation.primary),
          // secondary / tertiary used to leak the same internal
          // fields; the cart UI doesn't need them. Removed entirely.
          eligibleCount: r.allocation.allEligible.length,
        })),
      },
    };
  }

  /**
   * POST /storefront/allocate/reserve
   * Reserve stock for a specific seller-product mapping.
   */
  @Post('reserve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async reserveStock(@Body() body: ReserveRequestDto) {
    const reservation = await this.allocationService.reserveStock({
      mappingId: body.mappingId,
      quantity: body.quantity,
      orderId: body.orderId,
      expiresInMinutes: body.expiresInMinutes,
    });

    return {
      success: true,
      message: 'Stock reserved successfully',
      data: reservation,
    };
  }

  /**
   * POST /storefront/allocate/and-reserve
   * One-shot: rank candidates AND reserve stock against the best one, with
   * automatic primary→secondary→tertiary fallback if a higher-ranked
   * candidate loses a concurrent reservation race.
   */
  @Post('and-reserve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async allocateAndReserve(@Body() body: AllocateAndReserveDto) {
    const result = await this.allocationService.allocateAndReserve({
      productId: body.productId,
      variantId: body.variantId,
      customerPincode: body.customerPincode,
      quantity: body.quantity,
      orderId: body.orderId,
      expiresInMinutes: body.expiresInMinutes,
    });

    return {
      success: true,
      message:
        result.skippedMappingIds.length > 0
          ? `Reserved on ${result.chosenRank} after ${result.skippedMappingIds.length} fallback(s)`
          : `Reserved on ${result.chosenRank} candidate`,
      data: {
        reservation: result.reservation,
        chosenCandidate: result.chosenCandidate,
        chosenRank: result.chosenRank,
        skippedMappingIds: result.skippedMappingIds,
      },
    };
  }

  /**
   * POST /storefront/allocate/confirm
   * Confirm a reservation (after payment success).
   */
  @Post('confirm')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async confirmReservation(@Body() body: ConfirmRequestDto) {
    await this.allocationService.confirmReservation(body.reservationId, body.orderId);
    return {
      success: true,
      message: 'Reservation confirmed — stock deducted',
    };
  }

  /**
   * POST /storefront/allocate/release
   * Release a reservation (e.g. cart abandonment, payment failure).
   */
  @Post('release')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async releaseReservation(@Body() body: ReleaseRequestDto) {
    await this.allocationService.releaseReservation(body.reservationId);
    return {
      success: true,
      message: 'Reservation released — stock freed',
    };
  }

  /**
   * POST /storefront/allocate/reallocate
   * Re-allocate after a seller fails.
   */
  @Post('reallocate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async reallocate(@Body() body: ReallocateRequestDto) {
    const allocation = await this.allocationService.reallocate({
      orderId: body.orderId,
      failedMappingId: body.failedMappingId,
      productId: body.productId,
      variantId: body.variantId,
      customerPincode: body.customerPincode,
      quantity: body.quantity,
    });

    return {
      success: true,
      message: allocation.serviceable
        ? 'Re-allocation successful'
        : 'No alternative sellers available',
      data: {
        serviceable: allocation.serviceable,
        primary: allocation.primary,
        secondary: allocation.secondary,
        tertiary: allocation.tertiary,
        eligibleCount: allocation.allEligible.length,
      },
    };
  }
}
