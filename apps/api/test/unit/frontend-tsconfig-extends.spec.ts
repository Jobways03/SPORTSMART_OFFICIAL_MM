import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 8 (PR 8.5) — Frontend tsconfig.json must extend the shared base.
 *
 * Pre-PR-8.5, each of the eight frontend apps maintained its own
 * tsconfig.json with the identical Next.js boilerplate (target ES2017,
 * module bundler, strict, jsx preserve, the Next plugin, etc.). That
 * meant a bump to the toolchain target — say, ES2017 → ES2020 to use
 * native optional-chaining without polyfills, or strict-mode option
 * changes — had to land in eight files in lockstep, and a stale leaf
 * would silently compile against the old target. The classic "two
 * apps strict-bind-call-apply, six don't, find out at the integration
 * boundary" footgun.
 *
 * PR 8.5 introduces packages/tsconfig/nextjs-app.json as the single
 * source of truth for everything that doesn't depend on a leaf-relative
 * path. Leaves keep:
 *   - extends:    points at the shared base
 *   - paths:      relative to ./src/* of the leaf, can't sensibly live
 *                 in the base (paths in a base resolve relative to
 *                 the base's location, not the extending file)
 *   - include:    not inherited from extends — must be per-leaf
 *   - exclude:    same
 *
 * Everything else (target, lib, strict, module, moduleResolution,
 * jsx, plugins, etc.) lives only in the base. Bumping the toolchain
 * target now happens in one place; the spec is the guard that catches
 * a leaf that diverges (e.g. someone copies an existing tsconfig
 * instead of extending the base).
 *
 * Invariant enforced:
 *   1. Each apps/web-* has a tsconfig.json that extends
 *      "@sportsmart/tsconfig/nextjs-app.json".
 *   2. Each declares @sportsmart/tsconfig as a workspace devDep so
 *      the extends path resolves at install time.
 *   3. Each leaf does NOT redeclare any compilerOption that lives
 *      in the base — redeclaration is the silent-drift surface this
 *      consolidation was designed to close.
 *
 * Note on the redeclaration check: it specifically targets the
 * compiler options the base owns. paths, include, exclude (and any
 * future leaf-only override the team explicitly adds) stay allowed.
 */

const FRONTEND_APPS = [
  'web-admin',
  'web-admin-storefront',
  'web-affiliate',
  'web-affiliate-admin',
  'web-franchise',
  'web-franchise-admin',
  'web-seller',
  'web-storefront',
] as const;

const SHARED_BASE_EXTENDS = '@sportsmart/tsconfig/nextjs-app.json';
const SHARED_BASE_DEP = '@sportsmart/tsconfig';

const MONOREPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Compiler options that the shared base owns. A leaf that redeclares
// any of these is silently diverging from the consolidation — even if
// the redeclared value happens to match the base today, a future bump
// to the base would not propagate to the redeclaring leaf.
const BASE_OWNED_COMPILER_OPTIONS: ReadonlyArray<string> = [
  'target',
  'lib',
  'allowJs',
  'skipLibCheck',
  'strict',
  'noEmit',
  'esModuleInterop',
  'module',
  'moduleResolution',
  'resolveJsonModule',
  'isolatedModules',
  'jsx',
  'incremental',
  'plugins',
];

function readJson(p: string): any {
  // The shared base and all leaf tsconfigs are written as plain JSON
  // (any documentation lives in `_about` string properties, not
  // line comments). A naive `// → end of line` stripper would corrupt
  // protocol-relative substrings like `https://...`, so this spec
  // deliberately uses plain JSON.parse.
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

describe('Frontend tsconfig extends the shared base (PR 8.5)', () => {
  describe.each(FRONTEND_APPS)('%s', (app) => {
    const tsconfigPath = path.join(MONOREPO_ROOT, 'apps', app, 'tsconfig.json');
    const packagePath = path.join(MONOREPO_ROOT, 'apps', app, 'package.json');

    let tsconfig: any;
    let pkg: any;
    beforeAll(() => {
      tsconfig = readJson(tsconfigPath);
      pkg = readJson(packagePath);
    });

    it(`extends "${SHARED_BASE_EXTENDS}"`, () => {
      expect(tsconfig.extends).toBe(SHARED_BASE_EXTENDS);
    });

    it(`declares ${SHARED_BASE_DEP} as a devDependency`, () => {
      // The extends path is a node-resolved module specifier; without
      // an explicit devDep, pnpm wouldn't symlink the shared package
      // into the leaf's node_modules and tsc would fail to resolve.
      const v = pkg?.devDependencies?.[SHARED_BASE_DEP];
      expect(v).toBe('workspace:*');
    });

    it('does not redeclare any compiler option that the base owns', () => {
      // Catches "I copy-pasted from an existing tsconfig and edited
      // one field" — the redeclaration silently breaks the
      // single-source-of-truth invariant.
      const declared = tsconfig.compilerOptions ?? {};
      const conflicts = BASE_OWNED_COMPILER_OPTIONS.filter(
        (opt) => Object.prototype.hasOwnProperty.call(declared, opt),
      );
      if (conflicts.length > 0) {
        throw new Error(
          `${app}/tsconfig.json redeclares base-owned compilerOptions: ${conflicts.join(', ')}. ` +
            `Remove them from the leaf and rely on the extends chain, or move the value into the base if it should change globally.`,
        );
      }
      expect(conflicts).toEqual([]);
    });
  });

  it('the shared base package.json exists', () => {
    const basePkg = readJson(
      path.join(MONOREPO_ROOT, 'packages', 'tsconfig', 'package.json'),
    );
    expect(basePkg.name).toBe(SHARED_BASE_DEP);
  });

  it('the shared base nextjs-app.json exists and contains the expected core options', () => {
    const base = readJson(
      path.join(MONOREPO_ROOT, 'packages', 'tsconfig', 'nextjs-app.json'),
    );
    // Smoke-check a few of the base-owned options. A full structural
    // assertion would be brittle — the point of the package is that
    // changes to these values are easy. Just confirm the package is
    // doing its job (strict on, jsx preserve, etc.).
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.jsx).toBe('preserve');
    expect(base.compilerOptions.moduleResolution).toBe('bundler');
  });
});
