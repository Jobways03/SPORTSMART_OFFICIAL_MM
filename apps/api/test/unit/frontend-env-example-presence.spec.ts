import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 9 (PR 9.6) — Every frontend app must have a .env.example file.
//
// Pre-PR-9.6, three of the eight frontends (web-admin-storefront,
// web-affiliate, web-affiliate-admin) had no .env.example at all.
// Five of the eight did. A fresh developer cloning the repo and
// trying to bring up a frontend with no template hits the same
// dead-end as the operator in PR 9.1: no documentation of which env
// vars the app needs, no copy-template path, just an empty .env that
// the next.js dev server reads as "every env var is undefined."
//
// The fix is the file. The spec is the guard that it stays:
//
//   1. Every apps/web-* directory must have a .env.example file.
//   2. The file must declare at least one NEXT_PUBLIC_* key (the
//      minimum content for a Next.js frontend that talks to anything
//      — typically NEXT_PUBLIC_API_URL pointing at the API origin).
//
// The second rule is a "non-empty file" guard. An empty .env.example
// passes the existence check trivially but provides no documentation.
// Requiring a NEXT_PUBLIC_ key ensures the file is actually useful.
//
// Detection strategy:
//   - Enumerate immediate subdirectories of apps/ whose name starts
//     with "web-" and have a package.json.
//   - For each, assert .env.example exists and contains at least
//     one NEXT_PUBLIC_X=... line.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const APPS_DIR = path.join(REPO_ROOT, 'apps');

function listFrontendApps(): string[] {
  const entries = fs.readdirSync(APPS_DIR, { withFileTypes: true });
  const apps: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('web-')) continue;
    if (!fs.existsSync(path.join(APPS_DIR, e.name, 'package.json'))) continue;
    apps.push(e.name);
  }
  return apps.sort();
}

describe('Frontend .env.example presence + minimum content (PR 9.6)', () => {
  const apps = listFrontendApps();

  it('discovered at least one frontend app (sanity)', () => {
    expect(apps.length).toBeGreaterThan(0);
  });

  describe.each(apps)('apps/%s', (app: string) => {
    const examplePath = path.join(APPS_DIR, app, '.env.example');

    it('has a .env.example file', () => {
      const present = fs.existsSync(examplePath);
      if (!present) {
        throw new Error(
          `apps/${app}/ has no .env.example file. A developer cloning the repo would have no documentation of which env vars the app expects. ` +
            `Create apps/${app}/.env.example with at minimum a NEXT_PUBLIC_API_URL pointing at the local API origin.`,
        );
      }
      expect(present).toBe(true);
    });

    it('declares at least one NEXT_PUBLIC_* env var (non-empty content)', () => {
      if (!fs.existsSync(examplePath)) {
        return; // Previous test already failed; don't double-report.
      }
      const text = fs.readFileSync(examplePath, 'utf8');
      const hasNextPublic = /^\s*NEXT_PUBLIC_[A-Z0-9_]+\s*=/m.test(text);
      if (!hasNextPublic) {
        throw new Error(
          `apps/${app}/.env.example exists but declares no NEXT_PUBLIC_* env var. ` +
            `An empty template passes existence checks but provides no documentation. ` +
            `Add at least NEXT_PUBLIC_API_URL=http://localhost:8000.`,
        );
      }
      expect(hasNextPublic).toBe(true);
    });
  });
});
