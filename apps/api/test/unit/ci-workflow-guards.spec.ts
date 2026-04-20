import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Coverage guard for the API CI workflow.
 *
 * The intent is to make deletion or silent-disable of critical checks
 * visible: if someone rips `tsc --noEmit` out of the workflow, this
 * suite fails and they have to update the assertion with a reason in
 * the PR. That is a cheaper enforcement mechanism than code-review
 * vigilance.
 *
 * The test deliberately does NOT parse YAML (no runtime YAML parser
 * is installed and adding one is overkill). It matches the exact text
 * patterns that the workflow author would have to touch to remove a
 * check, which is enough for a guard.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');
const workflowPath = join(repoRoot, '.github', 'workflows', 'api-ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');

describe('.github/workflows/api-ci.yml — required steps', () => {
  it('runs on pull requests touching apps/api', () => {
    expect(workflow).toMatch(/pull_request:\s*\n[\s\S]*?paths:/);
    expect(workflow).toMatch(/apps\/api\/\*\*/);
  });

  it('pins the same Node major as the Dockerfile (currently 22)', () => {
    // Diverging Node versions between CI and the runtime image is a
    // classic source of "it works in CI but prod crashes" bugs.
    expect(workflow).toMatch(/NODE_VERSION:\s*"22"/);
  });

  it('pins the same pnpm version as the Dockerfile (currently 10.0.0)', () => {
    // pnpm lockfile semantics changed between 8/9/10; both places
    // must agree or a cached lockfile can behave differently.
    expect(workflow).toMatch(/PNPM_VERSION:\s*"10\.0\.0"/);
  });

  it('uses --frozen-lockfile so a drifting lockfile fails CI instead of silently updating', () => {
    expect(workflow).toContain('--frozen-lockfile');
  });

  it('runs prisma generate before typecheck and build', () => {
    // Match the *step* declarations, not the job-name banner (which
    // mentions "Typecheck" / "Build" near the top of the file).
    const generateIdx = workflow.indexOf('pnpm exec prisma generate');
    const typecheckIdx = workflow.indexOf('- name: Typecheck');
    const buildIdx = workflow.indexOf('- name: Build');
    expect(generateIdx).toBeGreaterThan(-1);
    expect(typecheckIdx).toBeGreaterThan(generateIdx);
    expect(buildIdx).toBeGreaterThan(generateIdx);
  });

  it('validates the Prisma schema (catches migration/schema drift)', () => {
    expect(workflow).toContain('prisma validate');
  });

  it('runs the lint, typecheck, unit test, e2e test, and build steps', () => {
    expect(workflow).toContain('pnpm --filter @sportsmart/api run lint');
    expect(workflow).toContain('tsc --noEmit');
    expect(workflow).toContain('pnpm --filter @sportsmart/api test');
    expect(workflow).toContain('pnpm --filter @sportsmart/api test:e2e');
    expect(workflow).toContain('pnpm --filter @sportsmart/api run build');
  });

  it('cancels superseded runs on the same ref', () => {
    // Developers push frequently while iterating; queuing ten
    // in-flight runs wastes CI minutes and delays the latest result.
    expect(workflow).toMatch(/cancel-in-progress:\s*true/);
  });
});
