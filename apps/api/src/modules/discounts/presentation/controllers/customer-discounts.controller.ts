import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { DiscountsService } from '../../application/services/discounts.service';

@ApiTags('Customer Discounts')
@Controller('customer/coupons')
@UseGuards(UserAuthGuard)
export class CustomerDiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  // POST /customer/coupons/validate
  @Post('validate')
  async validate(
    @Req() _req: any,
    @Body()
    body: {
      code: string;
      subtotal: number;
      items?: Array<{ productId: string; quantity: number; unitPrice: number }>;
    },
  ) {
    const data = await this.discountsService.validateCouponForCheckout(
      body.code,
      Number(body.subtotal || 0),
      Array.isArray(body.items) ? body.items : [],
    );
    return {
      success: true,
      message: 'Coupon applied',
      data: {
        code: data.code,
        title: data.title,
        valueType: data.valueType,
        value: data.value,
        discountAmount: data.discountAmount,
      },
    };
  }
}
