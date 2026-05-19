// Phase 36 — Customer-facing cart tax preview.
//
// Thin controller: defers to CartTaxPreviewService which orchestrates
// the cross-module reads via CartPublicFacade + CheckoutPublicFacade.
// The tax module never reads `cart` or `customer_addresses` tables
// directly.

import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import {
  CartTaxPreviewService,
} from '../../application/services/cart-tax-preview.service';
import type { CheckoutTaxPreviewResult } from '../../application/services/checkout-tax-preview.service';

interface CartPreviewBody {
  // Optional — when omitted, the default customer address is used.
  // Same field whether the customer typed it inline or selected
  // from their saved list.
  addressId?: string;
}

@ApiTags('Customer / Tax Preview')
@Controller('customer/tax-preview')
@UseGuards(UserAuthGuard)
export class CustomerCartTaxPreviewController {
  constructor(private readonly cartPreview: CartTaxPreviewService) {}

  @Post('cart')
  @HttpCode(HttpStatus.OK)
  async previewCart(
    @Req() req: any,
    @Body() body: CartPreviewBody,
  ): Promise<{
    success: true;
    message: string;
    data: CheckoutTaxPreviewResult | null;
  }> {
    const data = await this.cartPreview.preview({
      customerId: req.userId,
      addressId: body.addressId ?? null,
    });
    return {
      success: true,
      message: data ? 'Cart tax preview' : 'Empty cart',
      data,
    };
  }
}
