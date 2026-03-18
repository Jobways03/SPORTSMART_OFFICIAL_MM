import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Prisma } from '@prisma/client';

interface ListSellersInput {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  verificationStatus?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  fromDate?: string;
  toDate?: string;
}

const ALLOWED_SORT_FIELDS: Record<string, string> = {
  sellerName: 'sellerName',
  sellerShopName: 'sellerShopName',
  email: 'email',
  createdAt: 'createdAt',
  status: 'status',
  verificationStatus: 'verificationStatus',
  profileCompletionPercentage: 'profileCompletionPercentage',
};

@Injectable()
export class AdminListSellersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: ListSellersInput) {
    const {
      page,
      limit,
      search,
      status,
      verificationStatus,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      fromDate,
      toDate,
    } = input;

    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.SellerWhereInput = {
      isDeleted: false,
    };

    if (status) {
      where.status = status as any;
    }

    if (verificationStatus) {
      where.verificationStatus = verificationStatus as any;
    }

    if (fromDate) {
      where.createdAt = { ...(where.createdAt as any), gte: new Date(fromDate) };
    }

    if (toDate) {
      where.createdAt = { ...(where.createdAt as any), lte: new Date(toDate) };
    }

    if (search) {
      const searchTerm = search.trim();
      where.OR = [
        { sellerName: { contains: searchTerm, mode: 'insensitive' } },
        { sellerShopName: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { phoneNumber: { contains: searchTerm } },
        { id: { contains: searchTerm } },
      ];
    }

    // Build order clause
    const sortField = ALLOWED_SORT_FIELDS[sortBy] || 'createdAt';
    const orderBy: Prisma.SellerOrderByWithRelationInput = {
      [sortField]: sortOrder === 'asc' ? 'asc' : 'desc',
    };

    const [sellers, total] = await Promise.all([
      this.prisma.seller.findMany({
        where,
        select: {
          id: true,
          sellerName: true,
          sellerShopName: true,
          email: true,
          phoneNumber: true,
          status: true,
          verificationStatus: true,
          isEmailVerified: true,
          profileCompletionPercentage: true,
          isProfileCompleted: true,
          sellerProfileImageUrl: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.seller.count({ where }),
    ]);

    return {
      sellers: sellers.map((s) => ({
        sellerId: s.id,
        sellerName: s.sellerName,
        sellerShopName: s.sellerShopName,
        email: s.email,
        phoneNumber: s.phoneNumber,
        status: s.status,
        verificationStatus: s.verificationStatus,
        isEmailVerified: s.isEmailVerified,
        profileCompletionPercentage: s.profileCompletionPercentage,
        isProfileCompleted: s.isProfileCompleted,
        profileImageUrl: s.sellerProfileImageUrl,
        createdAt: s.createdAt,
        lastLoginAt: s.lastLoginAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
