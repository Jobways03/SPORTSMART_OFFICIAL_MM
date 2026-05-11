import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from './permission-registry';

/**
 * Phase 4 (PR 4.6) — registry coverage test.
 *
 * Three failure modes this test catches before they ship:
 *
 *   1. A controller declares `@Permissions('orders.canecl')` (typo).
 *      In strict mode that 403s every request through the route. In
 *      soak it logs a deny that no operator can act on because the
 *      key doesn't exist in the catalog. Test FAILS if any
 *      @Permissions(...) string is not in the registry.
 *
 *   2. A registry key has no system-role mapping and no controller
 *      using it. Probably dead config. Test WARNS via console.warn
 *      (does not fail — these can be intentional, e.g. only available
 *      to custom roles) but lists them so they're visible.
 *
 *   3. A registry key has no controller using it. Test WARNS — same
 *      logic: a permission you can grant but nothing reads is mostly
 *      harmless but indicates a removed feature wasn't fully cleaned
 *      up.
 *
 * The test walks src/ for *.controller.ts files and greps for
 * `@Permissions('a.b', 'c.d', ...)` literally. No Nest module wiring,
 * no DB, runs in <1s.
 */

const SRC_ROOT = path.resolve(__dirname, '../..');
const CONTROLLER_GLOB = /\.controller\.ts$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(path.join(dir, entry.name), out);
    } else if (CONTROLLER_GLOB.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Extract every quoted string passed to @Permissions(...). */
function extractPermissionKeys(source: string): string[] {
  const out: string[] = [];
  const decoratorRe = /@Permissions\(([^)]*)\)/g;
  const literalRe = /['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = decoratorRe.exec(source)) !== null) {
    const args = m[1];
    let lm: RegExpExecArray | null;
    while ((lm = literalRe.exec(args)) !== null) {
      out.push(lm[1]);
    }
    literalRe.lastIndex = 0;
  }
  return out;
}

describe('Permission registry coverage', () => {
  const files = walk(SRC_ROOT);
  const useByKey = new Map<string, string[]>();

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const keys = extractPermissionKeys(src);
    for (const k of keys) {
      const list = useByKey.get(k) ?? [];
      list.push(path.relative(SRC_ROOT, file));
      useByKey.set(k, list);
    }
  }

  it('finds at least one @Permissions(...) controller (sanity)', () => {
    expect(useByKey.size).toBeGreaterThan(0);
  });

  it('every @Permissions(...) key in controllers exists in the registry', () => {
    const unknown: Array<{ key: string; usedIn: string[] }> = [];
    for (const [key, usedIn] of useByKey.entries()) {
      if (!(key in PERMISSIONS)) {
        unknown.push({ key, usedIn });
      }
    }
    if (unknown.length > 0) {
      const detail = unknown
        .map((u) => `  - "${u.key}" used in: ${u.usedIn.join(', ')}`)
        .join('\n');
      throw new Error(
        `Unknown permission keys found in controllers. These will deny EVERY ` +
          `request in strict mode and log unrecognised deny events in soak.\n${detail}`,
      );
    }
  });

  it('reports registry keys that no controller uses (warn-only)', () => {
    const unused = ALL_PERMISSION_KEYS.filter((k) => !useByKey.has(k));
    if (unused.length > 0) {
      console.warn(
        `[registry-coverage] Permission keys declared but not used by any controller:\n` +
          unused.map((k) => `  - ${k}`).join('\n'),
      );
    }
    // Informational only — a registry key with no in-code use can still
    // be granted via custom role + checked in business logic.
    expect(true).toBe(true);
  });

  it('reports registry keys with no system-role mapping (warn-only)', () => {
    const grantedSet = new Set<string>();
    for (const perms of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
      for (const p of perms) grantedSet.add(p);
    }
    const ungranted = ALL_PERMISSION_KEYS.filter((k) => !grantedSet.has(k));
    if (ungranted.length > 0) {
      console.warn(
        `[registry-coverage] Permission keys not granted to any system role ` +
          `(reachable only via custom roles):\n` +
          ungranted.map((k) => `  - ${k}`).join('\n'),
      );
    }
    expect(true).toBe(true);
  });

  it('SUPER_ADMIN grants every registered permission', () => {
    const superAdmin = new Set(SYSTEM_ROLE_PERMISSIONS['SUPER_ADMIN'] ?? []);
    const missing = ALL_PERMISSION_KEYS.filter((k) => !superAdmin.has(k));
    expect(missing).toEqual([]);
  });
});
