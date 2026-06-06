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
const NATIVE_EXTERNALS = new Set(['sharp', 'bcrypt']);

module.exports = (options, webpack) => {
  const existing = options.externals
    ? Array.isArray(options.externals)
      ? options.externals
      : [options.externals]
    : [];

  return {
    ...options,
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
