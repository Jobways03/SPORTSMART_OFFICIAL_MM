import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  SessionRepository,
  SessionRecord,
} from '../../domain/repositories/session.repository';

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<SessionRecord | null> {
    return this.prisma.session.findUnique({ where: { id } }) as Promise<SessionRecord | null>;
  }

  async findByUserId(userId: string): Promise<SessionRecord[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
    }) as Promise<SessionRecord[]>;
  }

  async save(_session: unknown): Promise<void> {
    // Generic save - not used in current use-cases but kept for interface compliance
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async createSession(data: {
    userId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    return this.prisma.session.create({ data }) as Promise<SessionRecord>;
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
