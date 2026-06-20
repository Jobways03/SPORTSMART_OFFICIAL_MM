import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { PermissionsGuard } from '../../../../core/guards/permissions.guard';
import { RolesGuard } from '../../../../core/guards/roles.guard';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { RequiresStepUp } from '../../../../core/step-up/requires-step-up.decorator';
import { StepUpGuard } from '../../../../core/step-up/step-up.guard';
import { AdminMfaService } from '../../application/services/admin-mfa.service';
import { IssueMfaInviteDto } from '../dtos/issue-mfa-invite.dto';

/**
 * Admin-issued MFA enrolment invites.
 *
 * A SUPER_ADMIN mints a single-use, time-limited token for another admin so
 * the invitee can enrol their authenticator WITHOUT first logging in — closing
 * the first-login chicken-and-egg for a freshly-created SUPER_ADMIN (who is
 * hard-blocked at login until MFA is enrolled).
 *
 * Same guard stack as AdminUsersController: SUPER_ADMIN role + `roles.write`
 * permission + a fresh MFA step-up. The endpoint returns only an opaque token
 * (never a secret), so it does NOT reintroduce the "Admin A reads Admin B's
 * credentials" path that the removed reset-password route had — the secret is
 * minted only when the invitee redeems the token on the public enrol page.
 */
@ApiTags('Admin MFA')
@Controller('admin/mfa/invites')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard, StepUpGuard)
@Roles('SUPER_ADMIN')
@Permissions('roles.write')
export class AdminMfaInviteController {
  constructor(private readonly mfaService: AdminMfaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiresStepUp()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async issue(@Body() dto: IssueMfaInviteDto, @Req() req: Request) {
    const data = await this.mfaService.createEnrollmentInvite(dto.adminId, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      success: true,
      message:
        'MFA enrolment invite created. Share the single-use link with the admin; it expires soon and works without a prior login.',
      data,
    };
  }
}
