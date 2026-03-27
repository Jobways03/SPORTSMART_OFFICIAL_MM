import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class GetSellerProfileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        sellerName: true,
        sellerShopName: true,
        email: true,
        phoneNumber: true,
        sellerContactCountryCode: true,
        sellerContactNumber: true,
        storeAddress: true,
        locality: true,
        city: true,
        state: true,
        country: true,
        sellerZipCode: true,
        shortStoreDescription: true,
        detailedStoreDescription: true,
        sellerPolicy: true,
        sellerProfileImageUrl: true,
        sellerShopLogoUrl: true,
        status: true,
        isEmailVerified: true,
        profileCompletionPercentage: true,
        isProfileCompleted: true,
        lastProfileUpdatedAt: true,
        createdAt: true,
      },
    });

    if (!seller) {
      throw new NotFoundAppException('Seller profile not found');
    }

    return {
      sellerId: seller.id,
      email: seller.email,
      phoneNumber: seller.phoneNumber,
      sellerName: seller.sellerName,
      sellerShopName: seller.sellerShopName,
      sellerContactCountryCode: seller.sellerContactCountryCode,
      sellerContactNumber: seller.sellerContactNumber,
      storeAddress: seller.storeAddress,
      locality: seller.locality,
      city: seller.city,
      state: seller.state,
      country: seller.country,
      sellerZipCode: seller.sellerZipCode,
      shortStoreDescription: seller.shortStoreDescription,
      detailedStoreDescription: seller.detailedStoreDescription,
      sellerPolicy: seller.sellerPolicy,
      sellerProfileImageUrl: seller.sellerProfileImageUrl,
      sellerShopLogoUrl: seller.sellerShopLogoUrl,
      status: seller.status,
      isEmailVerified: seller.isEmailVerified,
      profileCompletionPercentage: seller.profileCompletionPercentage,
      isProfileCompleted: seller.isProfileCompleted,
      lastProfileUpdatedAt: seller.lastProfileUpdatedAt,
      createdAt: seller.createdAt,
    };
  }
}
