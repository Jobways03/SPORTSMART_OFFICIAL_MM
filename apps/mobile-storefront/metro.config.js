const path = require('node:path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {withNativeWind} = require('nativewind/metro');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

// Metro needs to see the workspace root so it can resolve hoisted/symlinked
// pnpm packages from packages/*. The two nodeModulesPaths cover the app's
// own deps and the workspace-root hoist; disableHierarchicalLookup keeps
// Metro from walking up to /Users/.../node_modules and surfacing junk.
const config = {
  projectRoot,
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
    unstable_enableSymlinks: true,
    // Honour the `exports` field in package.json so subpath imports
    // like `@posthog/core/surveys` resolve. Off by default in Metro
    // 0.81; posthog-react-native + other modern libs require it. Will
    // become the default in Metro 0.83+.
    unstable_enablePackageExports: true,
  },
};

module.exports = withNativeWind(mergeConfig(getDefaultConfig(projectRoot), config), {
  input: './global.css',
});
