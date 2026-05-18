import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  SESSION_REPOSITORY,
  SessionRepository,
} from '../../domain/repositories/session.repository';

/**
 * Customer logout — server-side session revocation.
 *
 * Revokes every active session for the user. The frontend separately
 * clears its locally-stored access/refresh tokens; the server-side
 * revoke ensures that if a refresh token is later replayed (cookie
 * exfiltrated, server log leak), it's rejected.
 *
 * Idempotent: re-calling has no effect beyond a second revoke pass.
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

  async execute(userId: string): Promise<void> {
    await this.sessionRepo.revokeAllUserSessions(userId);
    this.logger.log(`Customer logged out: ${userId}`);
  }
}
