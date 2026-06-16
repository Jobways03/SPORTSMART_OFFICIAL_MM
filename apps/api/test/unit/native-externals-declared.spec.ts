import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 0 deploy-readiness — Every native module marked as a webpack
// `commonjs` external MUST be a declared production dependency of the
// API package.
//
// Why this matters: webpack.config.js leaves `require('sharp')` /
// `require('bcrypt')` intact (NATIVE_EXTERNALS) because their
// platform-specific *.node binaries can't be bundled — they resolve
// from node_modules at runtime. The production image is built with
// `pnpm deploy --filter=@sportsmart/api --prod` (infra/docker/Dockerfile.api),
// which emits ONLY the declared dependency closure. If a native
// external is not a declared `dependency`, it is pruned out of the
// runtime image and the container throws "Cannot find module <x>" on
// the first code path that touches it — a defect invisible to `tsc`,
// `jest` (which run against the root-hoisted dev tree), and `nest build`.
//
// `sharp` was missing exactly this way: present only as a transitive of
// `next` in the web apps, so it resolved in dev but vanished from the
// API prod image. This spec makes that class of bug a build-time failure.

const API_DIR = path.resolve(__dirname, '..', '..');
const WEBPACK_CONFIG = path.join(API_DIR, 'webpack.config.js');
const PACKAGE_JSON = path.join(API_DIR, 'package.json');

function readNativeExternals(): string[] {
  const text = fs.readFileSync(WEBPACK_CONFIG, 'utf8');
  // Match: const NATIVE_EXTERNALS = new Set(['sharp', 'bcrypt']);
  const m = text.match(/NATIVE_EXTERNALS\s*=\s*new Set\(\s*\[([^\]]*)\]/);
  if (!m) {
    throw new Error(
      `Could not locate the NATIVE_EXTERNALS Set in ${WEBPACK_CONFIG}. ` +
        `If the externals declaration moved or changed shape, update this spec to match.`,
    );
  }
  return Array.from(m[1].matchAll(/['"]([^'"]+)['"]/g)).map((q) => q[1]);
}

describe('Webpack native externals are declared production dependencies (deploy readiness)', () => {
  const externals = readNativeExternals();
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const deps: Record<string, string> = pkg.dependencies ?? {};
  const devDeps: Record<string, string> = pkg.devDependencies ?? {};

  it('finds the expected native externals (sanity — guards the parser)', () => {
    // These two are the known native modules require()'d at runtime.
    // If either is intentionally removed, update this assertion.
    expect(externals).toEqual(expect.arrayContaining(['sharp', 'bcrypt']));
  });

  it.each(externals)(
    '"%s" is a declared production dependency (survives `pnpm deploy --prod`)',
    (mod: string) => {
      const inDeps = Object.prototype.hasOwnProperty.call(deps, mod);
      const inDevDeps = Object.prototype.hasOwnProperty.call(devDeps, mod);
      if (!inDeps) {
        throw new Error(
          `Native external "${mod}" (webpack commonjs external, require()'d at runtime) ` +
            `is ${inDevDeps ? 'only a devDependency' : 'not a declared dependency'} of @sportsmart/api. ` +
            `It will be pruned from the production image (pnpm deploy --prod) and the container ` +
            `will throw "Cannot find module ${mod}" at runtime. Add it to "dependencies" in apps/api/package.json.`,
        );
      }
      expect(inDeps).toBe(true);
    },
  );
});
