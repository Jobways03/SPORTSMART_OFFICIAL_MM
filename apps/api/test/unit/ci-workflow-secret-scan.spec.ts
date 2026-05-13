import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 9 (PR 9.5) — Every CI workflow must run a secret-scan step.
//
// .gitignore covers .env files, but it's a defence-against-omission,
// not a defence-against-commission: a developer who deliberately adds
// `apps/api/src/foo.ts` with an inline `const API_KEY = "sk-..."`
// bypasses the gitignore entirely. Secret scanning at the CI boundary
// catches credential patterns regardless of where they live.
//
// gitleaks-action ships a default ruleset that catches AWS / GCP /
// Azure / Razorpay / Stripe access keys, JWT signing secrets, private
// SSH/PGP keys, and high-entropy strings flagged as likely credentials.
// Running it as the first step (after checkout) means a detection
// fails the workflow before any install / build minutes are spent.
//
// Detection strategy:
//   - Walk .github/workflows/ for *.yml / *.yaml.
//   - For each, look for a step that invokes gitleaks-action OR
//     equivalent (the spec accepts a few common alternatives so
//     future replacement of the action with trufflehog or a CLI
//     install doesn't trip the check).
//
// Why a permissive pattern match: the security guarantee is "a
// scanner runs", not "specifically this scanner runs." If a future
// PR swaps gitleaks for trufflehog the spec keeps passing as long
// as some equivalent is in place.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

function listWorkflowFiles(): string[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .map((n) => path.join(WORKFLOWS_DIR, n))
    .sort();
}

// Patterns that count as "a secret scanner is in place".
// Add to this list if/when the team adopts a different tool.
const SECRET_SCAN_PATTERNS: RegExp[] = [
  /\bgitleaks\/gitleaks-action\b/i,
  /\btrufflesecurity\/trufflehog\b/i,
  /\bgitleaks\s+detect\b/, // CLI invocation (in `run:` shell steps)
  /\btrufflehog\s+(?:git|filesystem)\b/, // CLI invocation
];

function hasSecretScan(text: string): boolean {
  return SECRET_SCAN_PATTERNS.some((re) => re.test(text));
}

describe('CI workflow secret-scan invariant (PR 9.5)', () => {
  const workflows = listWorkflowFiles();

  it('discovers at least one CI workflow (sanity)', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  describe.each(workflows)('%s', (file: string) => {
    it('runs a secret-scan step (gitleaks / trufflehog / equivalent)', () => {
      const text = fs.readFileSync(file, 'utf8');
      const present = hasSecretScan(text);
      if (!present) {
        throw new Error(
          `${file} does not run any recognised secret-scanner step. ` +
            `Add a step that invokes gitleaks-action (default), trufflehog, or runs the gitleaks/trufflehog CLI in a "run:" step. ` +
            `See .github/workflows/api-ci.yml for the canonical pattern.`,
        );
      }
      expect(present).toBe(true);
    });
  });

  it('exposes the per-workflow scanner detection for diagnostic', () => {
    if (process.env.CI_SECRET_SCAN_REPORT === 'true') {
      const map: Record<string, boolean> = {};
      for (const f of workflows) {
        map[path.relative(REPO_ROOT, f)] = hasSecretScan(
          fs.readFileSync(f, 'utf8'),
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        'CI secret-scan coverage report:\n',
        JSON.stringify(map, null, 2),
      );
    }
    expect(workflows.length).toBeGreaterThanOrEqual(1);
  });
});
