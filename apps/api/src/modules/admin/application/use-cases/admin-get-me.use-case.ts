import { Inject, Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class AdminGetMeUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
  ) {}

  async execute(adminId: string) {
    const admin = await this.adminRepo.findAdminById(adminId, {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    });

    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }

    return {
      adminId: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
    };
  }
}
