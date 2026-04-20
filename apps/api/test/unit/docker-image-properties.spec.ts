import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the production Docker build.
 *
 * The Dockerfile + .dockerignore together determine three things we
 * really don't want to regress on:
 *
 *  1. The runtime image doesn't run as root.
 *  2. A healthcheck is wired so orchestrators can tell a wedged
 *     container from a healthy one.
 *  3. `.env` and friends never leak into a built image layer.
 *
 * A dev can always "fix" any of these with a casual edit. The point of
 * this test is to make the trade-off explicit: if you need to relax
 * one of these, you also need to update the assertion and explain why
 * in the PR.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');
const readFromRoot = (...parts: string[]) =>
  readFileSync(join(repoRoot, ...parts), 'utf8');

describe('infra/docker/Dockerfile.api — security-critical properties', () => {
  const dockerfile = readFromRoot('infra', 'docker', 'Dockerfile.api');

  it('runs the runtime stage as a non-root user', () => {
    expect(dockerfile).toMatch(/^USER\s+node\b/m);
  });

  it('declares a HEALTHCHECK that hits the liveness probe', () => {
    expect(dockerfile).toMatch(/HEALTHCHECK\b[\s\S]*\/health\/live/);
  });

  it('pins a specific Node major so an upstream :latest can not flip us to an unvetted version', () => {
    // node:22-slim is the current LTS base. If someone bumps, that
    // should be a deliberate choice accompanied by a PR note.
    expect(dockerfile).toMatch(/^FROM node:22-slim\b/m);
  });

  it('pins a specific pnpm version via corepack prepare', () => {
    // Floating pnpm breaks reproducibility — lockfile semantics can
    // shift between pnpm 8/9/10. Pin alongside the Node base.
    expect(dockerfile).toMatch(/corepack\s+prepare\s+pnpm@\d+\.\d+\.\d+/);
  });

  it('copies only prod node_modules into the runtime stage', () => {
    // We use `pnpm deploy --prod --legacy /out` to build a flat,
    // devDependency-free tree. Copying `/workspace/.../node_modules`
    // directly into the runtime would ship the full dev tree — jest,
    // ts-jest, @types/*, all of it.
    expect(dockerfile).toMatch(/pnpm\s+deploy\s+[^\n]*--prod/);
    expect(dockerfile).toMatch(/COPY\s+--from=build[^\n]*\/out\/node_modules/);
  });
});

describe('.dockerignore — image-leak guards', () => {
  const dockerignore = readFromRoot('.dockerignore');

  it('excludes every .env file so credentials never land in an image layer', () => {
    // Matching `**/.env` covers the repo root and every app/package.
    expect(dockerignore).toMatch(/^\*\*\/\.env\s*$/m);
    expect(dockerignore).toMatch(/^\*\*\/\.env\.\*\s*$/m);
  });

  it('does not over-exclude the .env.example committed template', () => {
    // An un-negated `**/.env.*` would mask .env.example too, which
    // some build flows want to keep for reference. We negate it back.
    expect(dockerignore).toMatch(/^!\*\*\/\.env\.example\s*$/m);
  });

  it('excludes node_modules and build outputs so the builder re-creates them fresh', () => {
    expect(dockerignore).toMatch(/^\*\*\/node_modules\s*$/m);
    expect(dockerignore).toMatch(/^\*\*\/dist\s*$/m);
  });

  it('excludes the .git directory so image layers do not carry history', () => {
    expect(dockerignore).toMatch(/^\.git\s*$/m);
  });
});
