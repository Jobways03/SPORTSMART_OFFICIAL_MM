import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BLOCKED_WHILE_IMPERSONATING_KEY } from './blocked-while-impersonating.decorator';

/**
 * Phase 28 (2026-05-21) — refuse requests on routes marked with
 * `@BlockedWhileImpersonating()` when the calling token is an admin
 * impersonation token.
 *
 * Detection: SellerAuthGuard + FranchiseAuthGuard set
 * `req.isImpersonation = true` on requests authenticated via an
 * impersonation JWT. This guard reads that flag — it does NOT
 * re-parse the JWT — so it runs cheap (no crypto, no DB) and
 * trusts the upstream guard.
 *
 * Returns 403 with `code: 'IMPERSONATION_BLOCKED_ACTION'` so the
 * frontend can render a specific banner instead of a generic
 * "forbidden" message.
 *
 * No-op for routes without the decorator — same pattern as
 * `StepUpGuard`. Safe to stack into the class-level `@UseGuards`
 * chain wherever desired.
 */
@Injectable()
export class BlockedWhileImpersonatingGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const blocked = this.reflector.getAllAndOverride<boolean>(
      BLOCKED_WHILE_IMPERSONATING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!blocked) return true;

    const req = context.switchToHttp().getRequest();
    if (req?.isImpersonation) {
      throw new ForbiddenException({
        code: 'IMPERSONATION_BLOCKED_ACTION',
        message:
          'This action is not permitted while an admin is impersonating the account. Exit impersonation to perform it.',
      });
    }
    return true;
  }
}
