// NestJS bundles the API into a single dist/main.js via webpack. Native
// addons cannot be bundled: their platform-specific *.node binaries are
// resolved at runtime relative to the package directory, and that resolution
// breaks once the JS is inlined into the bundle (e.g. sharp throws
// "Could not load the sharp module using the darwin-arm64 runtime").
//
// Mark native modules as commonjs externals so webpack leaves `require('sharp')`
// / `require('bcrypt')` intact and they load from node_modules at runtime with
// correct platform-binary resolution. Path aliases (@src/*, @core/* …) and all
// other deps continue to be bundled exactly as before.
//
//   - @prisma/client: loads its platform-specific query-engine binary
//     (libquery_engine-*.node) via paths computed relative to the package at
//     runtime; bundling inlines that logic and breaks the engine lookup in the
//     linux container. Externalize so it resolves from node_modules.
//   - puppeteer: resolves a Chromium executable + native bits at runtime
//     (used by the tax HTML-to-PDF service); same bundling hazard.
//
// All four are declared production dependencies (enforced by
// test/unit/native-externals-declared.spec.ts) so `pnpm deploy --prod` keeps
// them in the runtime image.
const NATIVE_EXTERNALS = new Set(['sharp', 'bcrypt', '@prisma/client', 'puppeteer']);

module.exports = (options, webpack) => {
  const existing = options.externals
    ? Array.isArray(options.externals)
      ? options.externals
      : [options.externals]
    : [];

  // Transpile-only dev mode (TRANSPILE_ONLY=true): drop the
  // ForkTsCheckerWebpackPlugin so the build skips the whole-project type-check
  // pass — the single biggest memory hog (~1.8 GB) and the slow phase of a cold
  // `--watch` build. Types are already enforced by the test suite + the
  // `typecheck` script, so this only affects local run speed/RAM, never prod.
  // No-op (normal type-checked build) when the flag is unset.
  const plugins =
    process.env.TRANSPILE_ONLY === 'true'
      ? (options.plugins ?? []).filter(
          (p) => p && p.constructor && p.constructor.name !== 'ForkTsCheckerWebpackPlugin',
        )
      : options.plugins;

  return {
    ...options,
    plugins,
    externals: [
      ...existing,
      ({ request }, callback) => {
        if (NATIVE_EXTERNALS.has(request)) {
          return callback(null, 'commonjs ' + request);
        }
        return callback();
      },
    ],
  };
};
