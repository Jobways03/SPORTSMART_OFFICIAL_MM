import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  ConflictAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';

interface AddStaffInput {
  name: string;
  email: string;
  phone?: string;
  role: string;
  password: string;
}

interface UpdateStaffInput {
  name?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
}

@Injectable()
export class FranchiseStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchiseStaffService');
  }

  async listStaff(franchiseId: string) {
    const staff = await this.prisma.franchiseStaff.findMany({
      where: { franchiseId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return staff;
  }

  async addStaff(franchiseId: string, data: AddStaffInput) {
    // Pre-check for duplicate email — gives a clean error on the common
    // case. NOT the source of truth for uniqueness: two requests for
    // the same email can both pass this check before either insert
    // runs. The DB unique index is authoritative; we map its
    // constraint-violation error back to the same ConflictAppException
    // shape below so callers see one consistent response.
    const existing = await this.prisma.franchiseStaff.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new ConflictAppException('A staff member with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 12);

    try {
      const staff = await this.prisma.franchiseStaff.create({
        data: {
          franchiseId,
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          passwordHash,
          role: data.role as any,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      this.logger.log(`Staff member added to franchise ${franchiseId}: ${staff.id}`);

      return staff;
    } catch (err: any) {
      // P2002 = Prisma unique-constraint violation. The only unique
      // column on FranchiseStaff that an external caller can collide
      // with is `email`; map to the same ConflictAppException the
      // pre-check uses so the API response is identical whether the
      // duplicate was caught by our check or by the DB.
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          'A staff member with this email already exists',
        );
      }
      throw err;
    }
  }

  async updateStaff(franchiseId: string, staffId: string, data: UpdateStaffInput) {
    const staff = await this.prisma.franchiseStaff.findUnique({
      where: { id: staffId },
    });

    if (!staff) {
      throw new NotFoundAppException('Staff member not found');
    }

    if (staff.franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Staff member does not belong to this franchise');
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await this.prisma.franchiseStaff.update({
      where: { id: staffId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.log(`Staff member updated: ${staffId} (franchise ${franchiseId})`);

    return updated;
  }

  async removeStaff(franchiseId: string, staffId: string) {
    const staff = await this.prisma.franchiseStaff.findUnique({
      where: { id: staffId },
    });

    if (!staff) {
      throw new NotFoundAppException('Staff member not found');
    }

    if (staff.franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Staff member does not belong to this franchise');
    }

    // Soft-delete: set isActive = false
    await this.prisma.franchiseStaff.update({
      where: { id: staffId },
      data: { isActive: false },
    });

    this.logger.log(`Staff member removed (soft-delete): ${staffId} (franchise ${franchiseId})`);
  }

  async getStaff(franchiseId: string, staffId: string) {
    const staff = await this.prisma.franchiseStaff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!staff) {
      throw new NotFoundAppException('Staff member not found');
    }

    if ((staff as any).franchiseId !== undefined && (staff as any).franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Staff member does not belong to this franchise');
    }

    // Re-fetch with franchiseId check using a direct query
    const verified = await this.prisma.franchiseStaff.findFirst({
      where: { id: staffId, franchiseId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!verified) {
      throw new ForbiddenAppException('Staff member does not belong to this franchise');
    }

    return verified;
  }
}
