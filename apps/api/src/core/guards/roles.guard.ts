import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const user = req?.user;

    if (!user || !user.roles) {
      this.logDenied(req, requiredRoles, null);
      return false;
    }

    const allowed = requiredRoles.some((role) => user.roles.includes(role));
    if (!allowed) {
      this.logDenied(req, requiredRoles, user.roles);
    }
    return allowed;
  }

  /**
   * Emit a structured warn line so defender tooling (log shipper / SIEM) can
   * alert on elevated-privilege attempts. Deliberately minimal — no request
   * body, just enough to reconstruct who tried to do what.
   */
  private logDenied(
    req: any,
    required: string[],
    actorRoles: string[] | null,
  ) {
    this.logger.warn(
      `403: role mismatch on ${req?.method} ${req?.originalUrl ?? req?.url} — ` +
        `required=${JSON.stringify(required)} actor=${JSON.stringify({
          id: req?.user?.id ?? null,
          roles: actorRoles,
          ip: req?.ip,
        })}`,
    );
  }
}
