import { Injectable, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
} from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ALL_PERMISSION_KEYS } from './permission-registry';

/**
 * Route authorization inventory.
 *
 * Walks every registered @Controller + handler at runtime (Nest's
 * DiscoveryService) and reports the authorization posture of each route:
 * which guards are applied, which @Permissions / @Roles keys gate it, and
 * — the headline check — whether a route carries PermissionsGuard but NO
 * @Permissions metadata, which makes the guard a no-op (it passes through
 * when no permission is declared). That is the exact "guard registered but
 * unprotected" class of bug operators want to catch BEFORE flipping
 * PERMISSIONS_GUARD_STRICT.
 *
 * Also surfaces registry drift: @Permissions keys used in code that are
 * not in the registry (typos / removed keys still referenced), and
 * registry keys not used by any handler (orphans).
 */
export interface RouteAuthzEntry {
  controller: string;
  handler: string;
  method: string;
  path: string;
  guards: string[];
  permissions: string[];
  roles: string[];
  hasPermissionsGuard: boolean;
  hasAdminAuthGuard: boolean;
  /** PermissionsGuard applied but no @Permissions key → no-op guard. */
  unprotected: boolean;
}

export interface RouteAuthzInventory {
  totalRoutes: number;
  unprotectedRoutes: RouteAuthzEntry[];
  /** @Permissions keys referenced in code but absent from the registry. */
  driftKeys: string[];
  /** Registry keys not referenced by any handler. */
  orphanKeys: string[];
  routes: RouteAuthzEntry[];
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

@Injectable()
export class RouteAuthzInventoryService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  scan(): RouteAuthzInventory {
    const routes: RouteAuthzEntry[] = [];
    const usedKeys = new Set<string>();

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const controllerPath = this.guessString(
        Reflect.getMetadata(PATH_METADATA, metatype),
      );
      const classGuards = this.guardNames(Reflect.getMetadata(GUARDS_METADATA, metatype));
      const classPerms = this.asStringArray(this.reflector.get(PERMISSIONS_KEY, metatype));
      const classRoles = this.asStringArray(this.reflector.get(ROLES_KEY, metatype));

      const prototype = Object.getPrototypeOf(instance);
      const methodNames = this.methodNamesOf(prototype);

      for (const handlerName of methodNames) {
        const handler = prototype[handlerName];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined || method === null) continue; // not a route handler

        const handlerPath = this.guessString(Reflect.getMetadata(PATH_METADATA, handler));
        const handlerGuards = this.guardNames(Reflect.getMetadata(GUARDS_METADATA, handler));
        const guards = [...new Set([...classGuards, ...handlerGuards])];

        // Handler-level metadata overrides class-level (Nest semantics).
        const handlerPerms = this.asStringArray(this.reflector.get(PERMISSIONS_KEY, handler));
        const permissions = handlerPerms.length > 0 ? handlerPerms : classPerms;
        const handlerRoles = this.asStringArray(this.reflector.get(ROLES_KEY, handler));
        const roles = handlerRoles.length > 0 ? handlerRoles : classRoles;

        for (const p of permissions) usedKeys.add(p);

        const hasPermissionsGuard = guards.includes('PermissionsGuard');
        const hasAdminAuthGuard = guards.includes('AdminAuthGuard');
        routes.push({
          controller: metatype.name,
          handler: handlerName,
          method: METHOD_NAMES[method as number] ?? String(method),
          path: this.joinPath(controllerPath, handlerPath),
          guards,
          permissions,
          roles,
          hasPermissionsGuard,
          hasAdminAuthGuard,
          // No-op iff the only authz gate is PermissionsGuard with no key
          // AND no RolesGuard/@Roles is doing the gating instead.
          unprotected:
            hasPermissionsGuard && permissions.length === 0 && roles.length === 0,
        });
      }
    }

    const registry = new Set<string>(ALL_PERMISSION_KEYS);
    const driftKeys = [...usedKeys].filter((k) => !registry.has(k)).sort();
    const orphanKeys = ALL_PERMISSION_KEYS.filter((k) => !usedKeys.has(k)).sort();
    const unprotectedRoutes = routes.filter((r) => r.unprotected);

    return {
      totalRoutes: routes.length,
      unprotectedRoutes,
      driftKeys,
      orphanKeys,
      routes: routes.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────

  private methodNamesOf(prototype: object): string[] {
    // Nest >=9 exposes getAllMethodNames; fall back to own-property walk.
    const scanner = this.metadataScanner as unknown as {
      getAllMethodNames?: (proto: object) => string[];
    };
    if (typeof scanner.getAllMethodNames === 'function') {
      return scanner.getAllMethodNames(prototype);
    }
    return Object.getOwnPropertyNames(prototype).filter(
      (p) => p !== 'constructor' && typeof (prototype as any)[p] === 'function',
    );
  }

  private guardNames(guards: unknown): string[] {
    if (!Array.isArray(guards)) return [];
    return guards
      .map((g) => (typeof g === 'function' ? g.name : (g as any)?.constructor?.name))
      .filter((n): n is string => typeof n === 'string');
  }

  private asStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  private guessString(v: unknown): string {
    return typeof v === 'string' ? v : '';
  }

  private joinPath(a: string, b: string): string {
    const left = `/${a}`.replace(/\/+/g, '/').replace(/\/$/, '');
    const right = b ? `/${b}`.replace(/\/+/g, '/') : '';
    const joined = `${left}${right}`.replace(/\/+/g, '/');
    return joined === '' ? '/' : joined;
  }
}
