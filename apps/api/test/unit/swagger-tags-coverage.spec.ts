import 'reflect-metadata';
import { execSync } from 'child_process';
import { join } from 'path';

/**
 * Coverage guard for Swagger @ApiTags.
 *
 * Swagger UI groups endpoints by tag. A controller without @ApiTags
 * either lands in an un-named "default" bucket or disappears from the
 * group navigation entirely, which makes the docs less useful as the
 * surface grows. This test fails fast if any new @Controller is added
 * without a tag — a code-review prompt would catch it less reliably.
 *
 * The check is a simple grep over src/: every file that declares a
 * class-level @Controller(...) decorator must also declare @ApiTags.
 * If you are legitimately adding a Controller that shouldn't be in
 * Swagger (vanishingly rare — mostly internal webhooks), add it to
 * EXCLUDED below with a comment explaining why.
 */

const apiRoot = join(__dirname, '..', '..');

const sh = (cmd: string): string =>
  execSync(cmd, { cwd: apiRoot, encoding: 'utf8' });

const EXCLUDED = new Set<string>([
  // Add file paths here (relative to src/) only with a clear reason.
]);

describe('Swagger — every @Controller has @ApiTags', () => {
  const allControllers = sh("grep -rl '^@Controller(' src/")
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^src\//, ''));

  const tagged = new Set(
    sh("grep -rl '@ApiTags' src/")
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(/^src\//, '')),
  );

  it('finds a non-trivial number of controllers (sanity check)', () => {
    // If this hits 0 the regex is wrong or the codebase moved.
    expect(allControllers.length).toBeGreaterThan(20);
  });

  it('every controller is either tagged or explicitly excluded', () => {
    const missing = allControllers.filter(
      (p) => !tagged.has(p) && !EXCLUDED.has(p),
    );
    expect(missing).toEqual([]);
  });
});
