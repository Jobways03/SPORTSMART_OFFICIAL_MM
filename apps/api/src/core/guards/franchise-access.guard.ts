import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';
import { readAccessCookie } from '../auth/auth-cookie.helper';
import { ForbiddenAppException, UnauthorizedAppException } from '../exceptions';
import { FranchiseAuthGuard } from './franchise-auth.guard';
import { FranchiseActiveGuard } from './franchise-active.guard';
import { FranchiseStaffAuthGuard } from './franchise-staff-auth.guard';
import { STAFF_PERMISSIONS_KEY } from '../decorators/staff-permissions.decorator';

/**
 * Phase 159u (staff-auth B3) — a single guard accepting EITHER the franchise
 * OWNER token or a STAFF token on a franchise business endpoint.
 *
 *  - OWNER token (roles: FRANCHISE) → delegate to FranchiseAuthGuard +
 *    FranchiseActiveGuard (identical to the prior `@UseGuards(FranchiseAuthGuard,
 *    FranchiseActiveGuard)` chain — zero behaviour change for owners). The owner
 *    holds every capability, so @StaffPermissions is not enforced.
 *  - STAFF token (roles: FRANCHISE_STAFF) → delegate to FranchiseStaffAuthGuard
 *    (validates session + ACTIVE staff/franchise, sets req.staffId/franchiseId/
 *    staffPermissions), then enforce the route's @StaffPermissions.
 *
 * Both paths leave `req.franchiseId` set, so existing controllers are unchanged
 * except for swapping the guard + adding @StaffPermissions.
 */
@Injectable()
export class FranchiseAccessGuard implements CanActivate {
  private readonly ownerGuard: FranchiseAuthGuard;
  private readonly activeGuard: FranchiseActiveGuard;
  private readonly staffGuard: FranchiseStaffAuthGuard;

  constructor(
    private readonly reflector: Reflector,
    env: EnvService,
    prisma: PrismaService,
    redis: RedisService,
  ) {
    // Compose the existing guards directly (their deps are all @Global). The
    // owner path runs the IDENTICAL FranchiseAuthGuard + FranchiseActiveGuard
    // logic, so owners see zero behaviour change.
    this.ownerGuard = new FranchiseAuthGuard(env, prisma, redis);
    this.activeGuard = new FranchiseActiveGuard();
    this.staffGuard = new FranchiseStaffAuthGuard(env, prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) || undefined : undefined;
    const token = bearer ?? readAccessCookie(request, 'franchise');
    if (!token) throw new UnauthorizedAppException('Authentication required');

    // Peek (no signature check) at the roles claim to route to the right guard;
    // the chosen guard then verifies the signature with its own secret.
    let roles: string[] = [];
    try {
      const decoded = jwt.decode(token) as { roles?: string[] } | null;
      roles = decoded?.roles ?? [];
    } catch {
      roles = [];
    }

    if (roles.includes('FRANCHISE_STAFF')) {
      await this.staffGuard.canActivate(context);
      const required = this.reflector.getAllAndOverride<string | undefined>(
        STAFF_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      );
      // Fail-closed: a route with no @StaffPermissions is owner-only. Staff are
      // denied unless the route explicitly grants a permission they hold — so a
      // controller migrated to this guard never silently over-grants staff.
      if (!required) {
        throw new ForbiddenAppException('This action is restricted to the franchise owner');
      }
      if (!(request.staffPermissions ?? []).includes(required)) {
        throw new ForbiddenAppException(
          `Your role does not permit this action (requires ${required})`,
        );
      }
      return true;
    }

    // Owner path — exactly the prior guard chain.
    const ownerOk = await this.ownerGuard.canActivate(context);
    if (!ownerOk) return false;
    return this.activeGuard.canActivate(context) as boolean;
  }
}
