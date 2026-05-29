import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AdminRole } from '@prisma/client';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { AdminPermissionResolver } from '../authorization/admin-permission-resolver.service';
import { JWT_VERIFY_OPTIONS_ADMIN } from '../auth/jwt-constants';
import { readAccessCookie } from '../auth/auth-cookie.helper';
import { UnauthorizedAppException } from '../exceptions';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  sessionId: string;
}

// Source the allowed admin roles from the Prisma-generated enum at
// runtime so the list cannot drift from the schema. Previously this
// was a hardcoded array which silently went stale every time someone
// added or renamed an AdminRole value in admin.prisma.
const ADMIN_ROLES: readonly string[] = Object.values(AdminRole);

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
    // PR 4.6 — resolves effective permissions per request so the
    // PermissionsGuard / PolicyGuard layered after us can evaluate
    // @Permissions(...) and @Policy(...). Lives in /core/authorization
    // and is provided by the global GuardsModule, so every domain
    // module that already imports AdminAuthGuard picks it up for free.
    private readonly permissionResolver: AdminPermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Follow-up #H40 — accept token from Bearer OR httpOnly cookie.
    // Bearer wins when both present so a client mid-migration still
    // works without ambiguity.
    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;
    const token = bearer ?? readAccessCookie(request, 'admin');

    if (!token) {
      throw new UnauthorizedAppException('Admin authentication required');
    }

    let payload: AdminTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_ADMIN_SECRET'),
        JWT_VERIFY_OPTIONS_ADMIN,
      ) as AdminTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired admin token');
    }

    if (!payload.sub || !payload.role) {
      throw new UnauthorizedAppException('Invalid admin token');
    }
    if (!ADMIN_ROLES.includes(payload.role)) {
      throw new UnauthorizedAppException('Not an admin token');
    }

    if (!payload.sessionId) {
      throw new UnauthorizedAppException('Invalid token: missing session');
    }
    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        adminId: true,
      },
    });
    if (!session || session.adminId !== payload.sub) {
      throw new UnauthorizedAppException('Session not found');
    }
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedAppException('Session has expired');
    }

    // Verify the admin account is still ACTIVE and the role hasn't been
    // downgraded since the token was issued — re-check role from DB.
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true, role: true },
    });
    if (!admin) {
      throw new UnauthorizedAppException('Admin not found');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Admin account is not active');
    }
    if (admin.role !== payload.role) {
      throw new UnauthorizedAppException('Admin role has changed — please log in again');
    }

    // PR 4.6 — resolve effective permissions BEFORE attaching req.user
    // so PermissionsGuard / PolicyGuard see the populated set. The
    // resolver fails open (returns role-default permissions) rather
    // than throwing if the custom-role join errors; a hard failure
    // there would 403 SUPER_ADMIN, which is worse than degraded perms.
    const resolved = await this.permissionResolver.resolve(payload.sub, admin.role);
    if (!resolved.fullyResolved) {
      this.logger.warn(
        JSON.stringify({
          event: 'authz.resolver.degraded',
          adminId: payload.sub,
          role: admin.role,
          note: 'custom-role resolution failed; using role-default permissions only',
        }),
      );
    }

    request.adminId = payload.sub;
    request.adminEmail = admin.email;
    request.adminRole = admin.role;
    request.sessionId = session.id;
    // Populate the standard shape downstream guards expect:
    //   - PermissionsGuard reads req.user.permissions
    //   - PolicyGuard reads req.user.permissions + req.user.customRoles
    //   - RolesGuard reads req.user.roles
    //   - Audit + downstream services use req.user.type to disambiguate.
    request.user = {
      id: payload.sub,
      type: 'ADMIN' as const,
      roles: [admin.role],
      permissions: resolved.permissions,
      customRoles: resolved.customRoles,
    };
    return true;
  }
}
