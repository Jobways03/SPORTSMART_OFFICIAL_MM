import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 24 (2026-05-20) — PermissionsGuard wiring coverage.
 *
 * PermissionsGuard.canActivate returns true when
 * requiredPermissions.length === 0 (no @Permissions decorator at
 * class- or method-level). Without a CI check, a controller can
 * wire @UseGuards(AdminAuthGuard, PermissionsGuard) but forget to
 * declare any @Permissions, accidentally creating an "any-admin"
 * route that the developer believed was permission-gated.
 *
 * This spec walks every *.controller.ts under apps/api/src:
 *   1. For CLASS-LEVEL @UseGuards(...PermissionsGuard...): every
 *      public HTTP-method handler in the file must have either a
 *      class-level @Permissions OR a per-method @Permissions.
 *   2. For METHOD-LEVEL @UseGuards(...PermissionsGuard...): only the
 *      specific decorated handler must have @Permissions.
 *
 * Walks files; no Nest bootstrap, no DB. Runs in <1s.
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

interface HandlerInfo {
  method: string;
  decorators: string;
  hasPermissions: boolean;
  hasMethodUseGuardsWithPerms: boolean;
}

/** Find every HTTP-method handler with its decorator stack. */
function extractHandlers(src: string): HandlerInfo[] {
  const out: HandlerInfo[] = [];
  const re =
    /((?:^[ \t]*@[A-Za-z][^\n]*\n)+)[ \t]*(?:async\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)[^{]*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const decorators = m[1] ?? '';
    const handlerName = m[2] ?? '';
    const isHttpHandler =
      /@(Get|Post|Patch|Put|Delete|Head|Options|All)\b/.test(decorators);
    if (!isHttpHandler) continue;
    out.push({
      method: handlerName,
      decorators,
      hasPermissions: /@Permissions\(/.test(decorators),
      hasMethodUseGuardsWithPerms:
        /@UseGuards\([^)]*PermissionsGuard[^)]*\)/.test(decorators),
    });
  }
  return out;
}

/** True if there is a class-level @UseGuards(...PermissionsGuard...).
 *  We look at decorators sitting above `export class ... {`. */
function classWiresPermissionsGuard(src: string): boolean {
  const m = src.match(/((?:@[A-Z][^\n]*\n\s*)*)export\s+class\s+[A-Za-z0-9_]+/);
  if (!m) return false;
  return /@UseGuards\([^)]*PermissionsGuard[^)]*\)/.test(m[1] ?? '');
}

/** True if the file declares a class-level @Permissions(...) above
 *  `export class ... {`. */
function classHasPermissions(src: string): boolean {
  const m = src.match(/((?:@[A-Z][^\n]*\n\s*)*)export\s+class\s+[A-Za-z0-9_]+/);
  if (!m) return false;
  return /@Permissions\(/.test(m[1] ?? '');
}

describe('PermissionsGuard wiring coverage', () => {
  const files = walk(SRC_ROOT);
  const offenders: Array<{ file: string; missing: string[] }> = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Skip files that don't reference PermissionsGuard at all.
    if (!/PermissionsGuard/.test(src)) continue;

    const classGuard = classWiresPermissionsGuard(src);
    const classPerms = classHasPermissions(src);
    const handlers = extractHandlers(src);

    const missing: string[] = [];
    for (const h of handlers) {
      const isGuarded = classGuard || h.hasMethodUseGuardsWithPerms;
      if (!isGuarded) continue;
      const isPermitted = classPerms || h.hasPermissions;
      if (!isPermitted) missing.push(h.method);
    }

    if (missing.length > 0) {
      offenders.push({
        file: path.relative(SRC_ROOT, file),
        missing,
      });
    }
  }

  it('every PermissionsGuard-wired route declares @Permissions', () => {
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  - ${o.file}\n      handlers without @Permissions: ${o.missing.join(', ')}`)
        .join('\n');
      throw new Error(
        `PermissionsGuard is wired but @Permissions is missing on ${offenders.length} controller(s). ` +
          `Without @Permissions the guard returns true unconditionally, so these routes are effectively ` +
          `"any logged-in admin". Add a class-level or per-method @Permissions(...) decorator.\n${detail}`,
      );
    }
  });
});
