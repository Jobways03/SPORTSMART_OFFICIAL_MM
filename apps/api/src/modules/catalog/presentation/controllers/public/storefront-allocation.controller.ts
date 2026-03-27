import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  SellerAllocationService,
  AllocationResult,
} from '../../../application/services/seller-allocation.service';
import { BadRequestAppException } from '../../../../../core/exceptions';

// ── DTOs (inline — lightweight) ──────────────────────────────────────────

interface AllocateItemDto {
  productId: string;
  variantId?: string;
  quantity: number;
}

interface AllocateRequestDto {
  items: AllocateItemDto[];
  customerPincode: string;
}

interface ReserveRequestDto {
  mappingId: string;
  quantity: number;
  orderId?: string;
  expiresInMinutes?: number;
}

interface ReallocateRequestDto {
  orderId: string;
  failedMappingId: string;
  productId: string;
  variantId?: string;
  customerPincode: string;
  quantity: number;
}

// ── Controller ───────────────────────────────────────────────────────────

@ApiTags('Storefront')
@Controller('storefront/allocate')
export class StorefrontAllocationController {
  constructor(
    private readonly allocationService: SellerAllocationService,
  ) {}

  /**
   * POST /storefront/allocate
   * Pre-allocation: returns ranked sellers for each item at a customer pincode.
   * Called during checkout, before payment.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async allocate(@Body() body: AllocateRequestDto) {
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestAppException('items array is required and cannot be empty');
    }
    if (!body.customerPincode) {
      throw new BadRequestAppException('customerPincode is required');
    }

    const results: {
      productId: string;
      variantId: string | null;
      quantity: number;
      allocation: AllocationResult;
    }[] = [];

    for (const item of body.items) {
      if (!item.productId) {
        throw new BadRequestAppException('Each item must have a productId');
      }
      if (!item.quantity || item.quantity < 1) {
        throw new BadRequestAppException('Each item must have quantity >= 1');
      }

      const allocation = await this.allocationService.allocate({
        productId: item.productId,
        variantId: item.variantId,
        customerPincode: body.customerPincode,
        quantity: item.quantity,
      });

      results.push({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        allocation,
      });
    }

    const allServiceable = results.every((r) => r.allocation.serviceable);

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
          primary: r.allocation.primary,
          secondary: r.allocation.secondary,
          tertiary: r.allocation.tertiary,
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
  @HttpCode(HttpStatus.CREATED)
  async reserveStock(@Body() body: ReserveRequestDto) {
    if (!body.mappingId) {
      throw new BadRequestAppException('mappingId is required');
    }
    if (!body.quantity || body.quantity < 1) {
      throw new BadRequestAppException('quantity must be >= 1');
    }

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
   * POST /storefront/allocate/confirm
   * Confirm a reservation (after payment success).
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmReservation(
    @Body() body: { reservationId: string; orderId?: string },
  ) {
    if (!body.reservationId) {
      throw new BadRequestAppException('reservationId is required');
    }

    await this.allocationService.confirmReservation(
      body.reservationId,
      body.orderId,
    );

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
  @HttpCode(HttpStatus.OK)
  async releaseReservation(@Body() body: { reservationId: string }) {
    if (!body.reservationId) {
      throw new BadRequestAppException('reservationId is required');
    }

    await this.allocationService.releaseReservation(body.reservationId);

    return {
      success: true,
      message: 'Reservation released — stock freed',
    };
  }

  /**
   * POST /storefront/allocate/reallocate
   * Re-allocate after a seller fails (T6 fallback).
   */
  @Post('reallocate')
  @HttpCode(HttpStatus.OK)
  async reallocate(@Body() body: ReallocateRequestDto) {
    if (!body.orderId) throw new BadRequestAppException('orderId is required');
    if (!body.failedMappingId) throw new BadRequestAppException('failedMappingId is required');
    if (!body.productId) throw new BadRequestAppException('productId is required');
    if (!body.customerPincode) throw new BadRequestAppException('customerPincode is required');
    if (!body.quantity || body.quantity < 1) throw new BadRequestAppException('quantity must be >= 1');

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
