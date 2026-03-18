import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';

export interface UserTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sessionId: string;
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly envService: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedAppException('Authentication required');
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(
        token,
        this.envService.getString('JWT_ACCESS_SECRET'),
      ) as UserTokenPayload;

      if (!payload.sub || !payload.roles?.includes('CUSTOMER')) {
        throw new UnauthorizedAppException('Invalid customer token');
      }

      request.userId = payload.sub;
      request.userEmail = payload.email;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedAppException) throw error;
      throw new UnauthorizedAppException('Invalid or expired token');
    }
  }
}
