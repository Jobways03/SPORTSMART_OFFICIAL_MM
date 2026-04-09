import { Injectable } from '@nestjs/common';
import { CartService } from '../services/cart.service';

@Injectable()
export class CartPublicFacade {
  constructor(private readonly cartService: CartService) {}

  async getCart(customerId: string) {
    return this.cartService.getCart(customerId);
  }

  async clearCart(customerId: string) {
    return this.cartService.clearCart(customerId);
  }
}
