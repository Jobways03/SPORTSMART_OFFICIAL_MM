import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { ShippingOptionsService } from '../../application/services/shipping-options.service';

@ApiTags('Customer Shipping Options')
@Controller('customer/shipping-options')
@UseGuards(UserAuthGuard)
export class CustomerShippingOptionsController {
  constructor(private readonly service: ShippingOptionsService) {}

  /**
   * Given a cart subtotal (already discount-applied client-side for the
   * preview), return all live shipping options + each one's computed
   * fee. The server doesn't trust the subtotal for order placement —
   * checkout/place-order recomputes against the session — but for the
   * preview shown on the checkout page, this is good enough.
   */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  async quote(@Body() body: { netCartValueInPaise: string | number }) {
    const cart = BigInt(body.netCartValueInPaise ?? 0);
    const options = await this.service.quoteForCart({
      netCartValueInPaise: cart,
    });
    return {
      success: true,
      message: 'Shipping options retrieved',
      data: options.map((o) => ({
        ...o,
        priceInPaise: o.priceInPaise.toString(),
        feeInPaise: o.feeInPaise.toString(),
        freeShippingMinCartPaise:
          o.freeShippingMinCartPaise?.toString() ?? null,
        amountMoreForFreeShippingInPaise:
          o.amountMoreForFreeShippingInPaise?.toString() ?? null,
      })),
    };
  }
}
