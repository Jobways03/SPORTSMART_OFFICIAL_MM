import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class PrismaSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.session.findUnique({ where: { id } });
  }

  async findByUserId(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
    });
  }
}
