import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  sessionId: string;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly envService: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedAppException('Admin authentication required');
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(
        token,
        this.envService.getString('JWT_ACCESS_SECRET'),
      ) as AdminTokenPayload;

      if (!payload.sub || !payload.role) {
        throw new UnauthorizedAppException('Invalid admin token');
      }

      // Only allow admin roles
      const adminRoles = ['SUPER_ADMIN', 'SELLER_ADMIN', 'SELLER_SUPPORT', 'SELLER_OPERATIONS'];
      if (!adminRoles.includes(payload.role)) {
        throw new UnauthorizedAppException('Not an admin token');
      }

      request.adminId = payload.sub;
      request.adminEmail = payload.email;
      request.adminRole = payload.role;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedAppException) throw error;
      throw new UnauthorizedAppException('Invalid or expired admin token');
    }
  }
}
