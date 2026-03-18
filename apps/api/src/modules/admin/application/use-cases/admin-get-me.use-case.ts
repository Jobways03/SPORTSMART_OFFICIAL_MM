import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class AdminGetMeUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(adminId: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
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
