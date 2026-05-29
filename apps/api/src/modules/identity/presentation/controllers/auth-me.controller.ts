import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 17 (2026-05-20) — Customer session probe.
 *
 * GET /auth/me is the cookie-friendly replacement for the frontend's
 * sessionStorage-based "am I logged in?" check. The route is guarded
 * by UserAuthGuard, which validates:
 *
 *   • access JWT signature, algorithm pin, issuer, audience;
 *   • Session row exists, not revoked, not expired;
 *   • User row exists and is ACTIVE.
 *
 * If any check fails the guard returns 401 — the frontend reads that
 * as "not logged in" and renders the public state. On success the
 * response carries ONLY the safe profile fields needed to render the
 * navbar / dropdown. Tokens are deliberately not echoed (they live
 * in the httpOnly cookie; the JS layer never needs to see them).
 */
@ApiTags('Auth')
@Controller('auth')
@UseGuards(UserAuthGuard)
export class AuthMeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(
    @Req() req: Request & { userId?: string; sessionId?: string },
  ) {
    if (!req.userId) {
      // Guard should already throw 401 in this case; defensive.
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailVerified: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    return {
      success: true,
      message: 'Session valid',
      data: {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
      },
    };
  }
}
