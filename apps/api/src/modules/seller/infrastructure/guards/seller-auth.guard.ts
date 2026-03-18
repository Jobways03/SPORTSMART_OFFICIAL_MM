import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';

export interface SellerTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sessionId: string;
}

@Injectable()
export class SellerAuthGuard implements CanActivate {
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
      ) as SellerTokenPayload;

      if (!payload.sub || !payload.roles?.includes('SELLER')) {
        throw new UnauthorizedAppException('Invalid seller token');
      }

      request.sellerId = payload.sub;
      request.sellerEmail = payload.email;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedAppException) throw error;
      throw new UnauthorizedAppException('Invalid or expired token');
    }
  }
}
