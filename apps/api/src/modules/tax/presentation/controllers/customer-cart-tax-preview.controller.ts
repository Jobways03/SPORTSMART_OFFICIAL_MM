// Phase 36 — Customer-facing cart tax preview.
//
// Used by /cart on the storefront to show CGST/SGST/IGST/cess before
// the customer enters the checkout flow. Reads:
//   - the customer's current cart server-side (no input trust)
//   - the supplied address (or the default if omitted) for the
//     place-of-supply decision
// and delegates to CheckoutTaxPreviewService.
//
// Returns the same shape as the checkout-time preview so the storefront
// can reuse a single component to render it.

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
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CheckoutTaxPreviewService,
  CheckoutTaxPreviewResult,
} from '../../application/services/checkout-tax-preview.service';
import {
  extractStateCodeFromAddress,
  buildStateIndex,
} from '../../domain/state-code-map';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxPreview: CheckoutTaxPreviewService,
  ) {}

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
    const userId: string = req.userId;

    // 1. Load the active cart with the same shape the checkout
    //    service uses. Filter out save-for-later items.
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: userId },
      include: {
        items: {
          where: { savedForLater: false },
          include: {
            product: {
              select: { id: true, sellerId: true, basePrice: true },
            },
            variant: {
              select: { id: true, price: true },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return { success: true, message: 'Empty cart', data: null };
    }

    // 2. Resolve the shipping address. Caller may pass an explicit
    //    addressId, else fall back to the default.
    const address = body.addressId
      ? await this.prisma.customerAddress.findFirst({
          where: { id: body.addressId, customerId: userId },
        })
      : await this.prisma.customerAddress.findFirst({
          where: { customerId: userId, isDefault: true },
        });

    // 3. Resolve state code: prefer the new `stateCode` column,
    //    fall back to a runtime name lookup against india_states.
    let customerShippingStateCode: string | null = null;
    if (address) {
      // Phase 34 — direct column when present.
      const direct = (address as any).stateCode as string | undefined;
      if (direct && /^[0-9]{2}$/.test(direct)) {
        customerShippingStateCode = direct;
      } else {
        // Legacy fallback — name lookup.
        const rows = await this.prisma.indiaState.findMany({
          where: { isActive: true },
          select: { gstStateCode: true, stateName: true },
        });
        const index = buildStateIndex(rows);
        const resolved = extractStateCodeFromAddress(
          { state: address.state, stateCode: (address as any).stateCode },
          index,
        );
        customerShippingStateCode = resolved.stateCode;
      }
    }

    // 4. Map cart items to the preview input shape. Prefer variant
    //    price when present; otherwise base price. Both are Decimal
    //    in DB → rupees → convert to paise.
    const items = cart.items.map((it) => {
      const unitPriceRupees = it.variant?.price ?? it.product.basePrice;
      const unitPriceInPaise = BigInt(
        Math.round(Number(unitPriceRupees) * 100),
      );
      return {
        productId: it.productId,
        variantId: it.variantId,
        unitPriceInPaise,
        quantity: it.quantity,
        sellerId: it.product.sellerId,
      };
    });

    const result = await this.taxPreview.previewForSession({
      items,
      customerShippingStateCode,
    });

    return {
      success: true,
      message: 'Cart tax preview',
      data: result,
    };
  }
}
