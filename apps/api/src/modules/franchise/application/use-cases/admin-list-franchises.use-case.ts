import { Injectable, Inject } from '@nestjs/common';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface AdminListFranchisesInput {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  verificationStatus?: string;
  sortBy?: string;
  sortOrder?: string;
}

@Injectable()
export class AdminListFranchisesUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
  ) {}

  async execute(input: AdminListFranchisesInput) {
    const page = input.page || 1;
    const limit = input.limit || 20;
    const { search, status, verificationStatus, sortBy } = input;
    const sortOrder = (input.sortOrder === 'asc' || input.sortOrder === 'desc')
      ? input.sortOrder
      : undefined;

    const { records, total } = await this.franchiseRepo.findAll({
      page,
      limit,
      search,
      status,
      verificationStatus,
      sortBy,
      sortOrder,
    });

    const franchises = records.map((f) => ({
      id: f.id,
      franchiseId: f.id,
      franchiseCode: f.franchiseCode,
      ownerName: f.ownerName,
      businessName: f.businessName,
      email: f.email,
      phoneNumber: f.phoneNumber,
      status: f.status,
      verificationStatus: f.verificationStatus,
      assignedZone: f.assignedZone,
      profileCompletionPercentage: f.profileCompletionPercentage,
      isProfileCompleted: f.isProfileCompleted,
      createdAt: f.createdAt,
    }));

    return {
      franchises,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
