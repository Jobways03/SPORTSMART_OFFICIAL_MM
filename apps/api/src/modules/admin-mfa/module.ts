import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { AdminModule } from '../admin/module';
import { AdminMfaService } from './application/services/admin-mfa.service';
import { BackupCodesService } from './application/services/backup-codes.service';
import { MfaSecretCipher } from './application/services/mfa-secret-cipher.service';
import { AdminMfaVerifyChallengeUseCase } from './application/use-cases/admin-mfa-verify-challenge.use-case';
import { AdminMfaAuthController } from './presentation/controllers/admin-mfa-auth.controller';
import { AdminMfaController } from './presentation/controllers/admin-mfa.controller';

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
 */
@Module({
  imports: [AdminModule],
  controllers: [AdminMfaController, AdminMfaAuthController],
  providers: [
    MfaSecretCipher,
    BackupCodesService,
    AdminMfaService,
    AdminMfaVerifyChallengeUseCase,
    AdminAuthGuard,
  ],
})
export class AdminMfaModule {}
