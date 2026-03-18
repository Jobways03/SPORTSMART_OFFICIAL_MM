import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class PermissionCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserRoles(userId: string): Promise<string[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId },
      include: { role: true },
    });
    return assignments.map((a) => a.role.name);
  }

  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const count = await this.prisma.rolePermission.count({
      where: {
        role: { assignments: { some: { userId } } },
        permission: { code: permissionCode },
      },
    });
    return count > 0;
  }
}
