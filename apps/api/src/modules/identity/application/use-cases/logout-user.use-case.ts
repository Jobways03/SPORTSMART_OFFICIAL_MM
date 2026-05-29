import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  SESSION_REPOSITORY,
  SessionRepository,
} from '../../domain/repositories/session.repository';

interface LogoutInput {
  userId: string;
  sessionId: string;
  /**
   * Phase 17 (2026-05-20) — when true, revoke every active session
   * for this user ("sign out everywhere"). Default (false) revokes
   * only the calling session, leaving the user signed in on other
   * devices.
   */
  all?: boolean;
}

/**
 * Phase 17 (2026-05-20) — Customer logout.
 *
 * Behaviour change vs prior implementation:
 *
 *   • Default: revoke ONLY the calling session (single-device sign-out).
 *     The previous version revoked every session on every logout —
 *     friendly to "I lost my phone" recovery but hostile to the
 *     normal "sign out on this laptop, stay signed in on my phone"
 *     UX. The "sign out everywhere" path moves behind an opt-in
 *     `?all=true` query param.
 *
 *   • Idempotent: re-calling for an already-revoked session is a
 *     silent no-op (the SessionRepository.revoke `update` writes
 *     `revokedAt = now()` regardless of prior state — replaying
 *     just stamps a fresher timestamp).
 */
@Injectable()
export class LogoutUserUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepo: SessionRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LogoutUserUseCase');
  }

  async execute(input: LogoutInput): Promise<{ revokedAll: boolean }> {
    if (input.all === true) {
      await this.sessionRepo.revokeAllUserSessions(input.userId);
      this.logger.log(
        `Customer logged out (all sessions): ${input.userId}`,
      );
      return { revokedAll: true };
    }
    await this.sessionRepo.revoke(input.sessionId);
    this.logger.log(
      `Customer logged out (single session): user=${input.userId} session=${input.sessionId}`,
    );
    return { revokedAll: false };
  }
}
