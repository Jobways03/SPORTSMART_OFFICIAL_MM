import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class IssueMfaInviteDto {
  // The admin to issue an MFA-enrolment invite for. Admin ids are opaque
  // strings (cuid), so we only assert non-empty + a sane length rather than a
  // UUID shape. The service 404s if the id doesn't resolve to an admin.
  @IsString({ message: 'adminId must be a string' })
  @IsNotEmpty({ message: 'adminId is required' })
  @MaxLength(64)
  adminId!: string;
}
