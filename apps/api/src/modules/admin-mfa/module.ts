import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { StepUpGuard } from '../../core/step-up/step-up.guard';
import { AdminModule } from '../admin/module';
import { NotificationsModule } from '../notifications/module';
import { AdminMfaService } from './application/services/admin-mfa.service';
import { BackupCodesService } from './application/services/backup-codes.service';
import { MfaSecretCipher } from './application/services/mfa-secret-cipher.service';
import { AdminMfaVerifyChallengeUseCase } from './application/use-cases/admin-mfa-verify-challenge.use-case';
import { AdminMfaAuthController } from './presentation/controllers/admin-mfa-auth.controller';
import { AdminMfaController } from './presentation/controllers/admin-mfa.controller';
import { AdminMfaNotificationHandler } from './application/event-handlers/admin-mfa-notification.handler';
import { MfaPendingSecretSweepCron } from './application/jobs/mfa-pending-secret-sweep.cron';

/**
 * Phase 10 (PR 10.5 + 10.6) — Admin MFA module.
 *
 * Composes the application services (cipher, enrollment service,
 * challenge verifier) and two HTTP controllers — one for enrollment
 * (authenticated, AdminAuthGuard) and one for the login-time MFA
 * verify step (unauthenticated, protected by the short-lived
 * challenge JWT itself).
 *
 * Imports AdminModule to get the ADMIN_REPOSITORY binding without
 * redeclaring the Prisma provider — the existing admin module owns
 * admin-row persistence; MFA is a thin layer that reads + writes
 * the MFA columns through that same repository.
 *
 * Phase 25 (2026-05-20):
 *   - Imports NotificationsModule for the side-channel email
 *     notification on every MFA state change.
 *   - Registers AdminMfaNotificationHandler (subscribes to
 *     `admin.mfa.*` events emitted by AdminMfaService).
 *   - Registers MfaPendingSecretSweepCron (clears expired pending
 *     enrolment secrets every 15 min via the leader-elected cron).
 *   - Registers StepUpGuard as a provider so the controller can
 *     @UseGuards(StepUpGuard) on /disable and /backup-codes/regenerate
 *     without each module re-declaring it.
 */
@Module({
  imports: [AdminModule, NotificationsModule],
  controllers: [AdminMfaController, AdminMfaAuthController],
  providers: [
    MfaSecretCipher,
    BackupCodesService,
    AdminMfaService,
    AdminMfaVerifyChallengeUseCase,
    AdminAuthGuard,
    StepUpGuard,
    AdminMfaNotificationHandler,
    MfaPendingSecretSweepCron,
  ],
})
export class AdminMfaModule {}
