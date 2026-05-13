import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 8 (PR 8.6) — Frontend .eslintrc.json must extend the shared base.
 *
 * Pre-PR-8.6, seven of the eight frontends had no .eslintrc file at
 * all and ran `next lint` against the bare Next defaults; the eighth
 * (web-storefront) had three team-flavoured rules (`no-explicit-any`,
 * `no-unused-vars`, `exhaustive-deps` — all at warn) that lived in
 * exactly one place and never propagated.
 *
 * PR 8.6 introduces packages/eslint-config/nextjs.json as the single
 * source of truth and hoists the storefront's three rules into it,
 * so every frontend now gets the same lint discipline. Future team
 * rules (a11y, security, naming conventions, banned imports) land in
 * the shared file and propagate to all eight apps in one edit.
 *
 * Invariant enforced:
 *   1. Each apps/web-* has a .eslintrc.json file.
 *   2. The file extends "@sportsmart/eslint-config/nextjs.json".
 *   3. The leaf does NOT redeclare `rules` — additions land in the
 *      shared config, not per-app. (If a future PR needs a genuine
 *      per-app override, that's a deliberate decision to widen this
 *      check rather than to silently let drift back in.)
 *   4. The shared package is declared as a workspace devDep so the
 *      extends resolves at install time.
 *
 * Same shape as the tsconfig-extends spec from PR 8.5 — different
 * file format, identical philosophy.
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

const SHARED_BASE_EXTENDS = '@sportsmart/eslint-config/nextjs.json';
const SHARED_BASE_DEP = '@sportsmart/eslint-config';

const MONOREPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('Frontend .eslintrc.json extends the shared base (PR 8.6)', () => {
  describe.each(FRONTEND_APPS)('%s', (app) => {
    const eslintrcPath = path.join(MONOREPO_ROOT, 'apps', app, '.eslintrc.json');
    const packagePath = path.join(MONOREPO_ROOT, 'apps', app, 'package.json');

    let eslintrc: any;
    let pkg: any;
    beforeAll(() => {
      eslintrc = readJson(eslintrcPath);
      pkg = readJson(packagePath);
    });

    it(`extends "${SHARED_BASE_EXTENDS}"`, () => {
      // Accept either the string form or a single-element array
      // form — both are valid ESLint syntax for a single extends.
      const ext = eslintrc.extends;
      const matched =
        ext === SHARED_BASE_EXTENDS ||
        (Array.isArray(ext) && ext.length === 1 && ext[0] === SHARED_BASE_EXTENDS);
      expect(matched).toBe(true);
    });

    it(`declares ${SHARED_BASE_DEP} as a devDependency`, () => {
      const v = pkg?.devDependencies?.[SHARED_BASE_DEP];
      expect(v).toBe('workspace:*');
    });

    it('does not redeclare a `rules` block — additions go in the shared config', () => {
      // The redeclaration footgun is the same as the tsconfig spec:
      // a leaf rule that happens to match the shared one today
      // detaches from future updates. Force every rule edit through
      // the shared file so the team gets a single audit trail.
      if (Object.prototype.hasOwnProperty.call(eslintrc, 'rules')) {
        throw new Error(
          `${app}/.eslintrc.json has its own \`rules\` block. ` +
            `Move them into packages/eslint-config/nextjs.json so they apply to every frontend, ` +
            `or widen this spec to allow per-app overrides if a documented exception is needed.`,
        );
      }
      expect(eslintrc.rules).toBeUndefined();
    });
  });

  it('the shared base package.json exists and declares eslint-config-next', () => {
    const basePkg = readJson(
      path.join(MONOREPO_ROOT, 'packages', 'eslint-config', 'package.json'),
    );
    expect(basePkg.name).toBe(SHARED_BASE_DEP);
    // The shared package owns the eslint-config-next dep so leaves
    // don't have to declare it. If this regresses, leaves start
    // failing to resolve "next/core-web-vitals" at lint time.
    expect(basePkg.dependencies?.['eslint-config-next']).toBeDefined();
  });

  it('the shared base nextjs.json extends next/core-web-vitals', () => {
    const base = readJson(
      path.join(MONOREPO_ROOT, 'packages', 'eslint-config', 'nextjs.json'),
    );
    const ext = base.extends;
    const matched =
      ext === 'next/core-web-vitals' ||
      (Array.isArray(ext) && ext.includes('next/core-web-vitals'));
    expect(matched).toBe(true);
  });
});
