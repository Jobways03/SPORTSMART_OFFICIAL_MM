import { Inject, Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';
import { AdminPermissionResolver } from '../../../../core/authorization/admin-permission-resolver.service';

@Injectable()
export class AdminGetMeUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    // PR 4.6 — the admin SPA's <RequirePermission> wrapper reads
    // `permissions` and `isSuperAdmin` off this response. Without them
    // every <RequirePermission superAdminOnly> page (Roles, Users)
    // redirects every admin — including real SUPER_ADMIN — to
    // /dashboard?denied=1. We compute them once here so the frontend
    // never needs a second round-trip.
    private readonly permissionResolver: AdminPermissionResolver,
  ) {}

  async execute(adminId: string) {
    const admin = await this.adminRepo.findAdminById(adminId, {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    });

    if (!admin) {
      throw new NotFoundAppException('Admin not found');
    }

    // Defensive null-check: the repo's projection-style typing leaves
    // every selected field as `T | undefined`, but a real Admin row
    // always has a role. Refuse to resolve permissions for an admin
    // whose role somehow isn't set, rather than passing undefined down
    // to the resolver where it would silently yield an empty set.
    if (!admin.role) {
      throw new NotFoundAppException('Admin role missing');
    }

    // Use the input adminId (guaranteed string) rather than admin.id
    // (typed `string | undefined` because the projection-style select
    // returns Partial<Admin>). Both values are the same row by the
    // findAdminById contract.
    const resolved = await this.permissionResolver.resolve(adminId, admin.role);

    return {
      adminId: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
      // Authorization shape used by the admin SPA. `isSuperAdmin` is a
      // role-enum shortcut so the UI can avoid scanning the (large)
      // permissions array for every render.
      permissions: resolved.permissions,
      customRoles: resolved.customRoles,
      isSuperAdmin: admin.role === 'SUPER_ADMIN',
    };
  }
}
