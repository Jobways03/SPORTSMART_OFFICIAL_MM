import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 8 (PR 8.1) — Frontend shared-dependency alignment invariant.
 *
 * The monorepo runs eight Next.js + React frontends under apps slash web hyphen-prefixed directories.
 * Today (PR 8.1 baseline), version ranges drift: six apps are on
 * `next ^15.0.0 / react ^19.0.0`, two (web-storefront, web-admin-
 * storefront) are on `next ^15.5.14 / react ^19.2.4`. The drift is
 * subtle but real:
 *
 *   - Two npm-installs in the same workspace can resolve to two
 *     different React versions if peers don't overlap; the resulting
 *     `react-is` / `scheduler` collisions surface as runtime errors
 *     that look unrelated to the cause.
 *   - Security patches to Next ship monthly; an unaligned monorepo
 *     means the upgrade has to be evaluated and merged eight times,
 *     and the lag between "first app upgraded" and "last app upgraded"
 *     is exactly the time window for a known CVE to remain exploitable
 *     against the laggards.
 *   - Shared packages (`@sportsmart/ui`, `@sportsmart/shared-utils`)
 *     peer-depend on React. Two divergent React versions in node_modules
 *     means the shared bundle has to be transpiled twice or risks
 *     runtime "Invalid Hook Call" failures.
 *
 * This spec asserts that, for a curated set of must-align dependencies,
 * the set of distinct version ranges across all eight frontends has
 * exactly the per-dep baseline count. Phase 8 progresses by shrinking
 * those baselines toward 1 (perfectly aligned). When every entry is 1,
 * frontend dep alignment is complete and this spec becomes a
 * permanent guard against re-introducing drift.
 *
 * Detection strategy:
 *   - Read each frontend app's package.json file.
 *   - For each must-align dep, collect the set of distinct version
 *     strings (e.g. `^15.0.0`, `^15.5.14`) across apps where the dep
 *     is declared.
 *   - Assert the set size equals the baseline.
 *   - A diagnostic log shows the per-dep app-by-app breakdown so the
 *     next PR has a concrete target.
 *
 * Why exact equality (not <=):
 *   - Same rationale as the Phase 7 coverage spec: a PR that aligns
 *     one app must also update the baseline. Silent progress hides
 *     where the work happened; tying the spec to the baseline keeps
 *     the audit trail in the test file.
 */

const FRONTEND_APPS = [
  'web-admin-storefront',
  'web-affiliate',
  'web-affiliate-admin',
  'web-d2c-seller',
  'web-d2c-seller-admin',
  'web-franchise',
  'web-franchise-admin',
  'web-retail-seller',
  'web-retail-seller-admin',
  'web-storefront',
] as const;

type DepLocation = 'dependencies' | 'devDependencies';

const MUST_ALIGN_DEPS: ReadonlyArray<{ name: string; in: DepLocation }> = [
  { name: 'next', in: 'dependencies' },
  { name: 'react', in: 'dependencies' },
  { name: 'react-dom', in: 'dependencies' },
  // PR 8.2 additions — TypeScript devDeps. Before this PR, only 2 of
  // 8 frontends declared these explicitly; the other 6 pulled them
  // transitively via pnpm hoisting, leaving the resolved version
  // implicit and prone to silent change when an upstream dep bumped.
  // The coherence check ("declared by all or none") catches the
  // partial-declaration case at CI time.
  { name: 'typescript', in: 'devDependencies' },
  { name: '@types/node', in: 'devDependencies' },
  { name: '@types/react', in: 'devDependencies' },
  { name: '@types/react-dom', in: 'devDependencies' },
  // Workspace deps are aligned by construction (workspace:*), so the
  // baseline is 1 — including them documents the intent and catches
  // a regression if a future PR pins a specific version.
  { name: '@sportsmart/shared-utils', in: 'dependencies' },
  // PR 8.5 — shared tsconfig package extending which is enforced by
  // the separate frontend-tsconfig-extends.spec. Added here so the
  // dep is also covered by the version-drift guard.
  { name: '@sportsmart/tsconfig', in: 'devDependencies' },
  // PR 8.6 — shared ESLint config package, paired with the
  // frontend-eslint-extends.spec.
  { name: '@sportsmart/eslint-config', in: 'devDependencies' },
];

// PR 8.3 — Optional shared deps. Used by *some* frontends but not all.
// The "all-or-none-declared" coherence rule for MUST_ALIGN_DEPS would
// nag here unnecessarily (Tailwind is genuinely web-storefront-only;
// the rich-text editor is genuinely admin-side-only). But when two or
// more apps DO declare the same dep, they should agree on the version
// — otherwise pnpm peer-resolution and hoisting decide which version
// each app sees at runtime, which is the exact silent-drift footgun
// the strict-align rule was built to close.
//
// Rule: across the apps that declare the dep, distinct version ranges
// must be ≤ 1. Apps that don't declare are exempt.
const OPTIONAL_ALIGN_DEPS: ReadonlyArray<{ name: string; in: DepLocation }> = [
  // Rich-text editor used by admin-side frontends (web-d2c-seller-admin,
  // web-retail-seller-admin, web-admin-storefront, web-d2c-seller,
  // web-retail-seller).
  { name: 'react-quill-new', in: 'dependencies' },
  // HTML sanitizer used where user-generated content is rendered
  // (web-d2c-seller / web-retail-seller for product descriptions, web-storefront for review
  // bodies).
  { name: 'isomorphic-dompurify', in: 'dependencies' },
  // Shared UI workspace package — adopted by some frontends (the
  // admin-side ones today), the rest will follow when the
  // component-consolidation PRs run.
  { name: '@sportsmart/ui', in: 'dependencies' },
];

// PR 8.1 — captured the audit baseline (next/react/react-dom at 2
// distinct ranges each). PR 8.2 — added the TypeScript devDep family
// at baseline 1 (all 8 frontends now declare them after the package
// edits). PR 8.4 — bumped the six laggards from ^15.0.0 / ^19.0.0
// to ^15.5.14 / ^19.2.4, closing the three remaining range-2
// entries. Every MUST_ALIGN entry is now at baseline 1 — strict
// alignment is mechanically complete. Future PRs that re-introduce
// drift fail the spec immediately.
const PHASE_8_BASELINE: Readonly<Record<string, number>> = {
  next: 1,
  react: 1,
  'react-dom': 1,
  typescript: 1,
  '@types/node': 1,
  '@types/react': 1,
  '@types/react-dom': 1,
  '@sportsmart/shared-utils': 1,
  '@sportsmart/tsconfig': 1,
  '@sportsmart/eslint-config': 1,
};

const MONOREPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

interface PerAppDep {
  app: string;
  version: string | null; // null = not declared
}

function readApps(): Record<string, Record<string, any>> {
  const out: Record<string, Record<string, any>> = {};
  for (const app of FRONTEND_APPS) {
    const pkgPath = path.join(MONOREPO_ROOT, 'apps', app, 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    out[app] = JSON.parse(raw);
  }
  return out;
}

function collectDepAcrossApps(
  pkgs: Record<string, Record<string, any>>,
  depName: string,
  location: DepLocation,
): PerAppDep[] {
  return FRONTEND_APPS.map((app) => {
    const v = pkgs[app]?.[location]?.[depName] ?? null;
    return { app, version: v };
  });
}

describe('Frontend shared-dep alignment invariant (PR 8.1)', () => {
  const pkgs = readApps();

  describe.each(MUST_ALIGN_DEPS)('$name', ({ name, in: location }) => {
    const baseline = PHASE_8_BASELINE[name] ?? 1;
    const perApp = collectDepAcrossApps(pkgs, name, location);
    const declared = perApp.filter((p) => p.version !== null);
    const distinctVersions = new Set(declared.map((p) => p.version));

    it(`current distinct-version-range count matches the Phase-8 baseline (${baseline})`, () => {
      // Exact equality so a PR that aligns the dep must also update
      // the baseline downward. The diagnostic test below logs the
      // app-by-app breakdown so the next PR has a concrete target.
      expect(distinctVersions.size).toBe(baseline);
    });

    it(`is declared by every frontend app (or none — declared on a subset is a footgun)`, () => {
      // A shared dep should be declared by either all frontends or
      // none. A partial declaration means the missing app pulls the
      // dep transitively, and pnpm hoisting decisions then determine
      // which version it sees — unstable and confusing.
      const presentCount = declared.length;
      const totalCount = FRONTEND_APPS.length;
      if (presentCount === 0 || presentCount === totalCount) {
        expect(true).toBe(true);
      } else {
        const missing = perApp.filter((p) => p.version === null).map((p) => p.app);
        throw new Error(
          `${name} is declared by ${presentCount}/${totalCount} frontends. ` +
            `Missing in: ${missing.join(', ')}. Add it explicitly to every frontend, or remove it everywhere.`,
        );
      }
    });
  });

  it('exposes the per-app dependency map for diagnostic / next-PR targeting', () => {
    if (process.env.FRONTEND_DEP_REPORT === 'true') {
      const report: Record<string, Record<string, string | null>> = {};
      for (const { name, in: location } of MUST_ALIGN_DEPS) {
        report[name] = {};
        for (const { app, version } of collectDepAcrossApps(pkgs, name, location)) {
          report[name][app] = version;
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        'Phase 8 frontend dep alignment map:\n',
        JSON.stringify(report, null, 2),
      );
    }
    expect(true).toBe(true);
  });

  it('every baseline entry corresponds to a registered must-align dep', () => {
    const declaredNames = new Set(MUST_ALIGN_DEPS.map((d) => d.name));
    const unknown = Object.keys(PHASE_8_BASELINE).filter(
      (k) => !declaredNames.has(k),
    );
    expect(unknown).toEqual([]);
  });

  // PR 8.3 — Optional shared deps. The "if declared, all declarers
  // agree on version" rule. Apps that don't declare the dep are
  // exempt; the rule only applies among those that do.
  describe.each(OPTIONAL_ALIGN_DEPS)('optional $name', ({ name, in: location }) => {
    const perApp = collectDepAcrossApps(pkgs, name, location);
    const declared = perApp.filter((p) => p.version !== null);
    const distinctVersions = new Set(declared.map((p) => p.version));

    it(`is either undeclared everywhere or every declarer agrees on the version`, () => {
      // Allowed states:
      //   - 0 declarers → no constraint (dep not in use yet)
      //   - N declarers, 1 distinct version → aligned
      // Disallowed:
      //   - N declarers, ≥2 distinct versions → drift
      if (declared.length === 0) {
        expect(true).toBe(true);
        return;
      }
      if (distinctVersions.size > 1) {
        const breakdown = declared
          .map((p) => `${p.app}=${p.version}`)
          .join(', ');
        throw new Error(
          `Optional dep ${name} has ${distinctVersions.size} distinct version ranges among declarers: ${breakdown}. Align them all to a single range, or accept the drift by adding the dep to MUST_ALIGN_DEPS and raising the baseline.`,
        );
      }
      expect(distinctVersions.size).toBeLessThanOrEqual(1);
    });
  });
});
