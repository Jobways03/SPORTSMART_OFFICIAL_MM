import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 9 (PR 9.3) — Every frontend app must be covered by the
// frontend CI workflow's build matrix.
//
// Pre-PR-9.3, only apps/api had a CI workflow. A change to a
// frontend that broke its TypeScript build, lint, or Next build
// could merge with no signal — eight Next.js apps and zero
// automated check on any of them. PR 9.3 adds
// .github/workflows/frontend-ci.yml with a matrix over all eight
// apps; this spec is the guard that the matrix and the actual
// apps/web-* directory contents stay in sync.
//
// Detection strategy:
//   - Enumerate every immediate subdirectory of apps/ whose name
//     starts with "web-" and has a package.json (filters out
//     stray directories that aren't real apps).
//   - Read .github/workflows/frontend-ci.yml as text.
//   - For each frontend app, assert the workflow's matrix.app list
//     contains it.
//
// Why text-grep over a YAML parser: the matrix list is a stable,
// trivially-recognisable shape ("  - <name>"). Adding a YAML parser
// dep for a single assertion isn't worth it. The trade-off is the
// spec would silently miss the workflow if the matrix were
// restructured (e.g. to use ${{ fromJSON(steps.detect.outputs.list) }}
// from a path-filter action) — that refactor would be a separate PR
// and would update this spec as part of its scope.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const APPS_DIR = path.join(REPO_ROOT, 'apps');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'frontend-ci.yml');

function listFrontendApps() {
  const entries = fs.readdirSync(APPS_DIR, { withFileTypes: true });
  const apps = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('web-')) continue;
    const pkgPath = path.join(APPS_DIR, e.name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    apps.push(e.name);
  }
  return apps.sort();
}

function workflowMatrixApps() {
  const text = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  // Find the `matrix:` block and the `app:` list under it. The
  // expected shape is:
  //
  //   matrix:
  //     app:
  //       - web-d2c-seller-admin
  //       - web-affiliate
  //
  // The list ends at the next non-list-item line (a line that
  // doesn't start with whitespace + dash).
  const matrixIdx = text.indexOf('matrix:');
  if (matrixIdx < 0) {
    throw new Error(
      'frontend-ci.yml has no `matrix:` block. The workflow may have ' +
        'been restructured; update this spec\'s extraction logic.',
    );
  }
  const after = text.slice(matrixIdx);
  const appBlock = after.match(/app:\s*\n((?:\s+-\s+web-[a-z0-9-]+\s*\n)+)/);
  if (!appBlock) {
    throw new Error(
      'Could not find `app:` list under `matrix:` in frontend-ci.yml.',
    );
  }
  const items = [];
  for (const line of appBlock[1].split('\n')) {
    const m = line.match(/^\s+-\s+(web-[a-z0-9-]+)\s*$/);
    if (m) items.push(m[1]);
  }
  return items.sort();
}

describe('Frontend CI workflow covers every frontend app (PR 9.3)', () => {
  const filesystemApps = listFrontendApps();
  const matrixApps = workflowMatrixApps();

  it('the frontend CI workflow file exists', () => {
    expect(fs.existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it('discovered at least one frontend app on disk (sanity)', () => {
    expect(filesystemApps.length).toBeGreaterThan(0);
  });

  describe.each(filesystemApps)('apps/%s', (app) => {
    it('is listed in the workflow matrix.app array', () => {
      const present = matrixApps.includes(app);
      if (!present) {
        throw new Error(
          `apps/${app}/ exists on disk but is NOT in the matrix.app list of .github/workflows/frontend-ci.yml. ` +
            `A change touching this app would not run CI. Add "- ${app}" to the matrix.`,
        );
      }
      expect(present).toBe(true);
    });
  });

  it('every matrix entry corresponds to a real frontend app directory', () => {
    // Reverse direction: a matrix entry without a backing directory
    // means CI is spending minutes on a dead app, or a typo will
    // skip a real app silently. Both bad.
    const stale = matrixApps.filter((m) => !filesystemApps.includes(m));
    if (stale.length > 0) {
      throw new Error(
        `Matrix list references non-existent app(s): ${stale.join(', ')}. ` +
          `Remove them from .github/workflows/frontend-ci.yml or restore the app directory.`,
      );
    }
    expect(stale).toEqual([]);
  });

  it('exposes the discovered-vs-matrix lists for diagnostic', () => {
    if (process.env.FRONTEND_CI_REPORT === 'true') {
      // eslint-disable-next-line no-console
      console.log(
        'Frontend CI matrix coverage report:\n',
        JSON.stringify({ filesystemApps, matrixApps }, null, 2),
      );
    }
    expect(filesystemApps.length).toBeGreaterThanOrEqual(1);
    expect(matrixApps.length).toBeGreaterThanOrEqual(1);
  });
});
