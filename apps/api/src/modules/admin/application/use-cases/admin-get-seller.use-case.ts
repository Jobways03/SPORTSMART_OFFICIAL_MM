import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class AdminGetSellerUseCase {
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
        verificationStatus: true,
        isEmailVerified: true,
        profileCompletionPercentage: true,
        isProfileCompleted: true,
        isDeleted: true,
        deletedAt: true,
        lastProfileUpdatedAt: true,
        lastLoginAt: true,
        failedLoginAttempts: true,
        lockUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    return {
      sellerId: seller.id,
      sellerName: seller.sellerName,
      sellerShopName: seller.sellerShopName,
      email: seller.email,
      phoneNumber: seller.phoneNumber,
      sellerContactCountryCode: seller.sellerContactCountryCode,
      sellerContactNumber: seller.sellerContactNumber,
      storeAddress: seller.storeAddress,
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
      verificationStatus: seller.verificationStatus,
      isEmailVerified: seller.isEmailVerified,
      profileCompletionPercentage: seller.profileCompletionPercentage,
      isProfileCompleted: seller.isProfileCompleted,
      lastProfileUpdatedAt: seller.lastProfileUpdatedAt,
      lastLoginAt: seller.lastLoginAt,
      failedLoginAttempts: seller.failedLoginAttempts,
      lockUntil: seller.lockUntil,
      createdAt: seller.createdAt,
      updatedAt: seller.updatedAt,
    };
  }
}
