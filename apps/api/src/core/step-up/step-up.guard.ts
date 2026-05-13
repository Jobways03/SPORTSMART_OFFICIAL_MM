import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  REQUIRES_STEP_UP_METADATA_KEY,
  RequiresStepUpOptions,
} from './requires-step-up.decorator';

/**
 * Phase 10 (PR 10.10) — Step-up auth enforcement guard.
 *
 * Composes with `AdminAuthGuard` — that guard runs first, populates
 * `req.sessionId`, and only then does this guard's `canActivate`
 * fire. The guard:
 *
 *   1. Reads `@RequiresStepUp` metadata from the handler / class.
 *      No metadata → pass through (this guard is a no-op on routes
 *      that don't opt in).
 *   2. Loads the AdminSession row for `req.sessionId` and checks
 *      `stepUpVerifiedAt`. Null or older than `maxAgeMs` → 403
 *      with a structured `code: 'STEP_UP_REQUIRED'` so the
 *      frontend can prompt for the TOTP.
 *
 * The 403 carries a specific error code so the frontend can
 * differentiate "step-up needed" from "you genuinely lack
 * permission" — different UX paths. The convention matches the
 * MFA-challenge response shape from PR 10.6.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequiresStepUpOptions>(
      REQUIRES_STEP_UP_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true; // route did not opt in

    const req = context.switchToHttp().getRequest();
    const sessionId = (req as { sessionId?: string }).sessionId;
    if (!sessionId) {
      // AdminAuthGuard should have run first; reaching the step-up
      // guard without a session id is a configuration error. Fail
      // closed.
      throw new ForbiddenException({
        code: 'STEP_UP_REQUIRED',
        message:
          'Step-up auth required, but no admin session was found. Re-authenticate and try again.',
      });
    }

    // The Prisma client's generated types catch up to the schema
    // when the operator runs `prisma generate` after the PR-10.10
    // migration. Until then, `stepUpVerifiedAt` is a known column
    // (declared in admin.prisma) but not in the generated select /
    // result types — cast at the call boundary so the schema is the
    // source of truth and the test suite doesn't require a fresh
    // generate to compile.
    const session = (await (
      this.prisma.adminSession.findUnique as any
    )({
      where: { id: sessionId },
      select: { stepUpVerifiedAt: true, revokedAt: true },
    })) as { stepUpVerifiedAt: Date | null; revokedAt: Date | null } | null;
    if (!session || session.revokedAt) {
      throw new ForbiddenException({
        code: 'STEP_UP_REQUIRED',
        message:
          'Session not found or revoked; step-up verification cannot be confirmed.',
      });
    }

    const maxAgeMs = meta.maxAgeMs ?? 5 * 60 * 1000;
    const now = Date.now();
    const verifiedAt = session.stepUpVerifiedAt?.getTime();
    if (!verifiedAt || now - verifiedAt > maxAgeMs) {
      throw new ForbiddenException({
        code: 'STEP_UP_REQUIRED',
        message:
          'This action requires a fresh MFA step-up. POST a TOTP code to /admin/mfa/step-up to elevate the session, then retry.',
        meta: { maxAgeMs },
      });
    }

    return true;
  }
}
