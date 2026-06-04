import 'reflect-metadata';
import { Controller, Get, Injectable, UseGuards } from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RouteAuthzInventoryService } from './route-authz-inventory.service';
import { Permissions } from '../decorators/permissions.decorator';

// The scanner matches guards by class NAME — so these local stand-ins
// named exactly PermissionsGuard / AdminAuthGuard are what it inspects.
@Injectable()
class PermissionsGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
@Injectable()
class AdminAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Controller('test/good')
@UseGuards(AdminAuthGuard, PermissionsGuard)
class GoodController {
  @Get('list')
  @Permissions('roles.read')
  list() {
    return [];
  }
}

@Controller('test/bad')
@UseGuards(AdminAuthGuard, PermissionsGuard)
class BadController {
  // PermissionsGuard applied but NO @Permissions key → no-op guard.
  @Get('open')
  open() {
    return [];
  }
}

@Controller('test/drift')
@UseGuards(AdminAuthGuard, PermissionsGuard)
class DriftController {
  @Get('x')
  @Permissions('not.a.real.key')
  x() {
    return [];
  }
}

describe('RouteAuthzInventoryService', () => {
  let svc: RouteAuthzInventoryService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [GoodController, BadController, DriftController],
      providers: [RouteAuthzInventoryService],
    }).compile();
    svc = mod.get(RouteAuthzInventoryService);
  });

  it('flags a PermissionsGuard route with no @Permissions as unprotected', () => {
    const inv = svc.scan();
    const bad = inv.unprotectedRoutes.find((r) => r.controller === 'BadController');
    expect(bad).toBeDefined();
    expect(bad?.handler).toBe('open');
    expect(bad?.hasPermissionsGuard).toBe(true);
    expect(bad?.permissions).toEqual([]);
  });

  it('does NOT flag a properly-decorated route as unprotected', () => {
    const inv = svc.scan();
    expect(inv.unprotectedRoutes.find((r) => r.controller === 'GoodController')).toBeUndefined();
  });

  it('detects registry drift — a @Permissions key not in the registry', () => {
    const inv = svc.scan();
    expect(inv.driftKeys).toContain('not.a.real.key');
  });

  it('records guards + permissions + method + path per route', () => {
    const inv = svc.scan();
    const good = inv.routes.find((r) => r.controller === 'GoodController');
    expect(good?.guards).toContain('PermissionsGuard');
    expect(good?.guards).toContain('AdminAuthGuard');
    expect(good?.permissions).toContain('roles.read');
    expect(good?.method).toBe('GET');
    expect(good?.path).toBe('/test/good/list');
  });
});
