import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 21 (2026-05-20) — Active-sessions list + revoke.
 *
 * Powers a future "Manage your devices" UI in the storefront so
 * customers can see every session their account currently has open
 * (with userAgent / deviceLabel / lastUsedAt / ipAddress) and revoke
 * stale ones without nuking the whole account via logout?all=true.
 *
 * Both endpoints are guarded by UserAuthGuard; the listing is scoped
 * to req.userId so a customer cannot enumerate or revoke another
 * user's sessions.
 */
@ApiTags('Auth')
@Controller('auth/sessions')
@UseGuards(UserAuthGuard)
export class SessionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Req() req: Request & { userId?: string; sessionId?: string },
  ) {
    if (!req.userId) throw new UnauthorizedException();
    const sessions = await this.prisma.session.findMany({
      where: { userId: req.userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        deviceLabel: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return {
      success: true,
      message: 'Active sessions',
      data: sessions.map((s) => ({
        sessionId: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        deviceLabel: s.deviceLabel,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
        isCurrent: s.id === req.sessionId,
      })),
    };
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Req() req: Request & { userId?: string; sessionId?: string },
    @Param('sessionId') sessionId: string,
  ) {
    if (!req.userId) throw new UnauthorizedException();
    // Scope by userId so a customer cannot revoke another user's
    // session by guessing its id.
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: req.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException(
        'Session not found or already revoked',
      );
    }
    return {
      success: true,
      message: 'Session revoked',
      data: { sessionId, revokedAt: new Date() },
    };
  }
}
