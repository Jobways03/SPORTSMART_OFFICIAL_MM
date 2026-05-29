import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { UserAuthGuard } from '../../../../core/guards';
import {
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  InventoryPublicFacade,
  MAX_RESERVATION_EXTENSION_MINUTES,
} from '../../../inventory/application/facades/inventory-public.facade';

/**
 * Phase 52 polish (2026-05-21) — customer-facing reservation
 * endpoints.
 *
 * Why these exist:
 *   - GET — storefront needs to render a countdown timer during
 *     checkout so the customer knows how much time they have left
 *     on the reservation. Pre-polish, `getReservation` was callable
 *     from internal code but no HTTP route exposed it (audit
 *     Gap #10).
 *   - POST /extend — when payment gateway 3DS dialogs take longer
 *     than expected the customer can request an extension. Capped
 *     at MAX_RESERVATION_EXTENSION_MINUTES per call and
 *     MAX_TOTAL_EXTENSIONS_MINUTES across the lifetime (audit
 *     Gap #13).
 *
 * Both endpoints verify that the calling customer owns the
 * reservation by matching the reservation's customerId column
 * (which Phase 52 added) against the JWT-authenticated userId. A
 * customer cannot inspect or extend another customer's reservation
 * even if they guess the id.
 */
class ExtendReservationDto {
  @IsInt({ message: 'extraMinutes must be an integer' })
  @Min(1, { message: 'extraMinutes must be at least 1' })
  @Max(MAX_RESERVATION_EXTENSION_MINUTES, {
    message: `extraMinutes must not exceed ${MAX_RESERVATION_EXTENSION_MINUTES}`,
  })
  extraMinutes!: number;
}

@ApiTags('Cart')
@Controller('customer/cart/reservations')
@UseGuards(UserAuthGuard)
export class CustomerReservationsController {
  constructor(private readonly inventory: InventoryPublicFacade) {}

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getReservation(@Req() req: any, @Param('id') id: string) {
    const reservation = await this.inventory.getReservation(id);
    if (!reservation) throw new NotFoundAppException('Reservation not found');
    // Ownership check — see docblock. A reservation created via the
    // guest checkout path may have customerId=null; we treat that as
    // "no customer can claim it via this endpoint" — guests must
    // identify themselves via the cart/session flow first.
    if (!reservation.customerId || reservation.customerId !== req.userId) {
      throw new ForbiddenAppException(
        'You do not have permission to view this reservation',
      );
    }
    return {
      success: true,
      data: {
        id: reservation.id,
        status: reservation.status,
        quantity: reservation.quantity,
        expiresAt: reservation.expiresAt,
        secondsRemaining: reservation.secondsRemaining,
      },
    };
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  async extend(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ExtendReservationDto,
  ) {
    // Ownership check happens before extending so we don't leak
    // existence of someone else's reservation via the extension
    // response.
    const reservation = await this.inventory.getReservation(id);
    if (!reservation) throw new NotFoundAppException('Reservation not found');
    if (!reservation.customerId || reservation.customerId !== req.userId) {
      throw new ForbiddenAppException(
        'You do not have permission to extend this reservation',
      );
    }
    const { expiresAt } = await this.inventory.extendReservation(
      id,
      body.extraMinutes,
    );
    return {
      success: true,
      message: 'Reservation extended',
      data: { expiresAt },
    };
  }
}
