import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class SellerPublicFacade {
  private readonly logger = new Logger(SellerPublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSellerById(sellerId: string): Promise<{
    id: string;
    sellerName: string;
    sellerShopName: string;
    email: string;
    phoneNumber: string;
    status: string;
    city: string | null;
    state: string | null;
    sellerZipCode: string | null;
    isEmailVerified: boolean;
    verificationStatus: string;
  } | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId, isDeleted: false },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        email: true,
        phoneNumber: true,
        status: true,
        city: true,
        state: true,
        sellerZipCode: true,
        isEmailVerified: true,
        verificationStatus: true,
      },
    });
    return seller;
  }

  async isSellerActive(sellerId: string): Promise<boolean> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId, isDeleted: false },
      select: { status: true },
    });
    return seller?.status === 'ACTIVE';
  }

  async getSellerPayoutProfile(sellerId: string): Promise<{
    id: string;
    sellerName: string;
    sellerShopName: string;
    email: string;
    status: string;
  } | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId, isDeleted: false },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        email: true,
        status: true,
      },
    });
    return seller;
  }

  async getSellerPickupAddress(sellerId: string): Promise<{
    storeAddress: string | null;
    locality: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    sellerZipCode: string | null;
  } | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId, isDeleted: false },
      select: {
        storeAddress: true,
        locality: true,
        city: true,
        state: true,
        country: true,
        sellerZipCode: true,
      },
    });
    return seller;
  }

  async getSellerPerformanceFlags(sellerId: string): Promise<{
    totalProducts: number;
    totalOrders: number;
    isProfileCompleted: boolean;
    isEmailVerified: boolean;
    profileCompletionPercentage: number;
  }> {
    const [seller, productCount, orderCount] = await Promise.all([
      this.prisma.seller.findUnique({
        where: { id: sellerId },
        select: {
          isProfileCompleted: true,
          isEmailVerified: true,
          profileCompletionPercentage: true,
        },
      }),
      this.prisma.sellerProductMapping.count({
        where: { sellerId, isActive: true },
      }),
      this.prisma.subOrder.count({
        where: { sellerId },
      }),
    ]);

    return {
      totalProducts: productCount,
      totalOrders: orderCount,
      isProfileCompleted: seller?.isProfileCompleted ?? false,
      isEmailVerified: seller?.isEmailVerified ?? false,
      profileCompletionPercentage: seller?.profileCompletionPercentage ?? 0,
    };
  }

  async validateSellerEligibility(sellerId: string): Promise<boolean> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId, isDeleted: false },
      select: {
        status: true,
        isEmailVerified: true,
        verificationStatus: true,
      },
    });

    if (!seller) return false;

    return (
      seller.status === 'ACTIVE' &&
      seller.isEmailVerified &&
      seller.verificationStatus === 'VERIFIED'
    );
  }

  async overrideStatus(
    sellerId: string,
    status: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.seller.update({
      where: { id: sellerId },
      data: { status: status as any },
    });

    this.logger.log(
      `Seller ${sellerId} status overridden to ${status}. Reason: ${reason}`,
    );
  }
}
