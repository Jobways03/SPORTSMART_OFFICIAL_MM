import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { CartService } from '../../application/services/cart.service';

@ApiTags('Cart')
@Controller('customer/cart')
@UseGuards(UserAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@Req() req: any) {
    const data = await this.cartService.getCart(req.userId);
    return { success: true, message: 'Cart retrieved', data };
  }

  @Post('items')
  async addItem(
    @Req() req: any,
    @Body() body: { productId: string; variantId?: string; quantity?: number },
  ) {
    const { productId, variantId, quantity = 1 } = body;
    await this.cartService.addItem(req.userId, productId, variantId, quantity);
    return { success: true, message: 'Item added to cart' };
  }

  @Patch('items/:itemId')
  async updateItem(
    @Req() req: any,
    @Param('itemId') itemId: string,
    @Body() body: { quantity: number },
  ) {
    const result = await this.cartService.updateItem(req.userId, itemId, body.quantity);
    return {
      success: true,
      message: result.removed ? 'Item removed from cart' : 'Cart item updated',
    };
  }

  @Delete('items/:itemId')
  async removeItem(@Req() req: any, @Param('itemId') itemId: string) {
    await this.cartService.removeItem(req.userId, itemId);
    return { success: true, message: 'Item removed from cart' };
  }

  @Delete()
  async clearCart(@Req() req: any) {
    await this.cartService.clearCart(req.userId);
    return { success: true, message: 'Cart cleared' };
  }
}
