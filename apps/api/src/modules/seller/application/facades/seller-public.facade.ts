import { Injectable } from '@nestjs/common';

@Injectable()
export class SellerPublicFacade {
  async getSellerById(sellerId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async isSellerActive(sellerId: string): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async getSellerPayoutProfile(sellerId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getSellerPickupAddress(sellerId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getSellerPerformanceFlags(sellerId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async validateSellerEligibility(sellerId: string): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async overrideStatus(sellerId: string, status: string, reason: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
