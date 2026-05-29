import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { hashRefreshToken } from '../../../../core/auth/refresh-token';
import {
  SessionRepository,
  SessionRecord,
} from '../../domain/repositories/session.repository';

/**
 * Phase 3 (PR 3.2) — refresh-token hashing at the storage boundary.
 *
 * Every write hashes the raw token before persisting; every read
 * hashes the incoming lookup value. Callers continue to pass raw
 * tokens (response bodies, request bodies) — the hash never leaks
 * past this repo.
 */
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

  async findByRefreshToken(refreshToken: string): Promise<SessionRecord | null> {
    return this.prisma.session.findFirst({
      where: { refreshToken: hashRefreshToken(refreshToken) },
    }) as Promise<SessionRecord | null>;
  }

  /**
   * Phase 3 (PR 3.6) — secondary lookup against the previous-rotation
   * hash. Hashes the raw input and queries only the burned-hash
   * column; the use-case calls this only after `findByRefreshToken`
   * misses, so the two-query cost is paid only on the (rare) theft
   * path.
   */
  async findByPreviousRefreshToken(refreshToken: string): Promise<SessionRecord | null> {
    return this.prisma.session.findFirst({
      where: { previousRefreshTokenHash: hashRefreshToken(refreshToken) },
    }) as Promise<SessionRecord | null>;
  }

  /**
   * Phase 3 (PR 3.6) — rotation now records the burned hash. We
   * read the current `refreshToken` value from the row, then in a
   * single update: stash that value into `previousRefreshTokenHash`
   * and write the new hash into `refreshToken`. The findUnique +
   * update pair is racy on its own (two concurrent rotations could
   * see the same "current"), but the refresh endpoint's caller
   * already serialises per-session (a single client driving its
   * own refresh), so the realistic concurrency is 1.
   */
  async rotateRefreshToken(
    sessionId: string,
    newRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<SessionRecord> {
    const current = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { refreshToken: true },
    });
    return this.prisma.session.update({
      where: { id: sessionId },
      data: {
        previousRefreshTokenHash: current?.refreshToken ?? null,
        refreshToken: hashRefreshToken(newRefreshToken),
        expiresAt: newExpiresAt,
        // Phase 17 (2026-05-20) — bump lastUsedAt on every rotate so
        // the inactive-session sweep + the /account/sessions UI can
        // tell active sessions from dormant ones.
        lastUsedAt: new Date(),
      },
    }) as Promise<SessionRecord>;
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
    deviceLabel?: string | null;
  }): Promise<SessionRecord> {
    return this.prisma.session.create({
      data: {
        userId: data.userId,
        refreshToken: hashRefreshToken(data.refreshToken),
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
        expiresAt: data.expiresAt,
        // Phase 17 (2026-05-20) — operator-friendly device label.
        deviceLabel: data.deviceLabel ?? null,
        // Stamp lastUsedAt at creation too, so a fresh session has
        // a non-null value the moment it's minted (no UI dash on
        // brand-new sessions).
        lastUsedAt: new Date(),
      },
    }) as Promise<SessionRecord>;
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
