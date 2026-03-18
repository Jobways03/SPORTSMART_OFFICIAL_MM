import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

@Injectable()
export class AdminLogoutUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminLogoutUseCase');
  }

  async execute(adminId: string): Promise<void> {
    // Revoke all active sessions for this admin
    await this.prisma.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Admin logged out: ${adminId}`);
  }
}
