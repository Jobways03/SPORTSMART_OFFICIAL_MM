import path from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteCommonjs} from '@originjs/vite-plugin-commonjs';

// Vite config for running the React Native app in a browser via
// react-native-web. The two critical pieces:
//
//   1. resolve.extensions — `.web.tsx` / `.web.ts` first so platform-
//      specific shims (lib/storage.web.ts, etc.) win over their native
//      siblings. Mirrors how Metro resolves on iOS/Android.
//
//   2. resolve.alias — `react-native` redirects to `react-native-web`,
//      which re-exports a DOM implementation of every RN primitive
//      we use. Without this, importing `View` from 'react-native'
//      blows up because the iOS/Android-native module isn't loadable
//      in a browser.
//
// Native-only packages (react-native-razorpay, react-native-keychain,
// etc.) are NOT aliased; they're replaced module-by-module via
// `.web.ts` files next to the native version.
export default defineConfig({
  root: path.resolve(__dirname),
  resolve: {
    extensions: [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      '.tsx',
      '.ts',
      '.jsx',
      '.js',
      '.json',
    ],
    alias: {
      // Some RN libraries import deep Fabric / codegen paths that
      // don't exist in react-native-web. Point them at an empty
      // stub so the bundler can resolve them; runtime never executes
      // the dead branches that touch these on web.
      'react-native/Libraries/Utilities/codegenNativeComponent': path.resolve(
        __dirname,
        'web/shims/empty-module.ts',
      ),
      'react-native/Libraries/Utilities/codegenNativeCommands': path.resolve(
        __dirname,
        'web/shims/empty-module.ts',
      ),
      'react-native/Libraries/ReactNative/AppContainer': path.resolve(
        __dirname,
        'web/shims/empty-module.ts',
      ),
      'react-native/Libraries/Pressability/PressabilityDebug': path.resolve(
        __dirname,
        'web/shims/empty-module.ts',
      ),
      'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry':
        path.resolve(__dirname, 'web/shims/empty-module.ts'),
      'react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactFabricPublicInstance':
        path.resolve(__dirname, 'web/shims/empty-module.ts'),
      // RN's asset registry ships in raw Flow syntax (`+width: ?number`)
      // that esbuild can't strip. The web doesn't need it — images
      // come from URL strings, not require()'d local assets — so we
      // alias to a no-op stub that satisfies the import surface.
      '@react-native/assets-registry/registry': path.resolve(
        __dirname,
        'web/shims/assets-registry-stub.ts',
      ),
      '@react-native/assets-registry': path.resolve(
        __dirname,
        'web/shims/assets-registry-stub.ts',
      ),
      'react-native': 'react-native-web',
      // The .web.ts files for native modules sit beside their native
      // siblings; Vite's extension resolution handles them. These
      // aliases catch imports that bypass our shims (e.g. a third-party
      // package importing react-native-razorpay directly).
      'react-native-razorpay': path.resolve(
        __dirname,
        'web/shims/razorpay-stub.ts',
      ),
      'react-native-keychain': path.resolve(
        __dirname,
        'web/shims/keychain-stub.ts',
      ),
      'react-native-fast-image': path.resolve(
        __dirname,
        'web/shims/fast-image-stub.ts',
      ),
      'react-native-image-picker': path.resolve(
        __dirname,
        'web/shims/image-picker-stub.ts',
      ),
      // @sentry/react-native pulls in iOS/Android bridge modules we
      // can't load in a browser. The shim exports the same surface
      // backed by @sentry/browser.
      '@sentry/react-native': path.resolve(
        __dirname,
        'web/shims/sentry-stub.ts',
      ),
      // posthog-react-native imports AsyncStorage which has a web
      // fallback (localStorage) but the package overall is heavy on
      // RN-isms; posthog-js is the proper web SDK.
      'posthog-react-native': path.resolve(
        __dirname,
        'web/shims/posthog-stub.ts',
      ),
      // gesture-handler imports deep RN internals (Pressability,
      // ReactFabricPublicInstance, etc.) that react-native-web
      // doesn't expose. The web doesn't need gesture handling —
      // CSS transitions cover swipe-back animation — so we stub
      // the entire package with no-op pass-throughs.
      'react-native-gesture-handler': path.resolve(
        __dirname,
        'web/shims/gesture-handler-stub.tsx',
      ),
      // NativeWind v4 needs its real cssInterop runtime on web —
      // the babel plugin emits JSX that calls it for className→style
      // mapping. We avoid loading the broken doctor.js (JSX in .js)
      // by excluding that subpath specifically.
      'react-native-css-interop/dist/doctor': path.resolve(
        __dirname,
        'web/shims/empty-module.ts',
      ),
      // react-native-image-picker's `Asset` type — re-export from shim.
      // (Already handled by the package alias above.)
    },
    dedupe: ['react', 'react-dom', 'react-native-web'],
  },
  define: {
    // RN globals Metro provides; we polyfill for the browser bundle.
    __DEV__: JSON.stringify(true),
    // @env shim — the babel plugin react-native-dotenv doesn't run in
    // Vite, so @env imports go through a virtual module instead.
    // Each var is injected via define so the imports resolve at build
    // time and stay no-op when unset.
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV ?? 'development',
    ),
  },
  plugins: [
    // Auto-convert every CJS module Vite encounters into ESM at
    // request time. Without this, each transitively-imported RN
    // package that publishes CJS surfaces a fresh "exports is not
    // defined" runtime error and we'd have to play whack-a-mole
    // adding them to optimizeDeps.include forever.
    viteCommonjs(),
    // NativeWind v4 requires its babel plugin even on web — it
    // rewrites JSX to use react-native-css-interop's jsx runtime so
    // className strings actually become CSS classes on the rendered
    // DOM. Without it, RN Web silently drops the className prop and
    // every Tailwind class is a no-op.
    react({
      babel: {
        // nativewind/babel exports a preset (not a plugin) — pass it
        // via `presets`. vite-plugin-react's own presets still run.
        presets: ['nativewind/babel'],
      },
    }),
    // Virtual module that maps `@env` imports to compile-time strings.
    // Cleaner than aliasing because dotenv values are easy to load
    // from a real .env file via Vite's loadEnv helper.
    {
      name: 'env-virtual-module',
      resolveId(id: string) {
        if (id === '@env') return '\0virtual:env';
        return null;
      },
      load(id: string) {
        if (id === '\0virtual:env') {
          const env = process.env;
          return [
            `export const RAZORPAY_KEY_ID = ${JSON.stringify(env.RAZORPAY_KEY_ID ?? '')};`,
            `export const API_URL = ${JSON.stringify(env.API_URL ?? '')};`,
            `export const SENTRY_DSN = ${JSON.stringify(env.SENTRY_DSN ?? '')};`,
            `export const SENTRY_ENVIRONMENT = ${JSON.stringify(env.SENTRY_ENVIRONMENT ?? '')};`,
            `export const POSTHOG_API_KEY = ${JSON.stringify(env.POSTHOG_API_KEY ?? '')};`,
            `export const POSTHOG_HOST = ${JSON.stringify(env.POSTHOG_HOST ?? '')};`,
          ].join('\n');
        }
        return null;
      },
    },
  ],
  server: {
    // Picked to avoid the existing :4000-:4009 + :8000 + :8081 ports
    // already in use by the rest of the stack. 5173 is Vite's default.
    port: 5173,
    host: true,
    strictPort: true,
    // Proxy /api/* through Vite so browser requests stay same-origin
    // and CORS isn't an issue. The native build talks directly to
    // localhost:8000; the web build talks to localhost:5173/api which
    // Vite forwards. Same backend, no API config change needed.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // Many RN libraries ship .js files with JSX (RN convention since
    // forever). Tell esbuild's dep scanner to treat all .js as JSX so
    // it doesn't choke on the first <View /> it finds in node_modules.
    esbuildOptions: {
      // `tsx` loader handles both JSX and TS-like type annotations
      // (RN libraries ship a mix of JSX-in-.js and Flow-typed-.js).
      // Plain `jsx` chokes on `export type X = ...` Flow syntax.
      loader: {'.js': 'tsx'},
      resolveExtensions: [
        '.web.tsx',
        '.web.ts',
        '.web.jsx',
        '.web.js',
        '.tsx',
        '.ts',
        '.jsx',
        '.js',
        '.json',
      ],
      mainFields: ['browser', 'module', 'main'],
    },
    // Most RN packages need pre-bundling so their CJS-only deps
    // (warn-once, use-latest-callback, react-freeze, nanoid, …)
    // get wrapped into proper ESM. The codegen / Fabric path errors
    // that previously forced us to exclude these are now handled by
    // the `react-native/Libraries/...` aliases at the top of this
    // config — empty stubs satisfy the imports without breaking
    // optimizer scanning.
    //
    // css-interop stays excluded: NativeWind's web runtime uses
    // Tailwind CSS via PostCSS directly, so the RN-style interop
    // module isn't on the web path.
    exclude: [],
    // needsInterop: true forces Vite to treat these packages as CJS
    // and wrap them with ESM helpers. The default heuristic is
    // probabilistic and can miss CJS modules that look ESM-ish; this
    // explicit list catches the ones causing "exports is not defined"
    // errors in the browser.
    needsInterop: [
      '@react-native-async-storage/async-storage',
      'use-latest-callback',
      'warn-once',
      'react-freeze',
      'nanoid',
      'nanoid/non-secure',
    ],
    // Be exhaustive — every CJS-flavoured package the browser
    // touches needs explicit inclusion so Vite wraps `exports.X`
    // into proper ESM. Missing one yields the classic
    // "ReferenceError: exports is not defined" at runtime because
    // Vite served the file as-is.
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-native-web',
      '@react-navigation/native',
      '@react-navigation/native-stack',
      '@react-navigation/bottom-tabs',
      '@react-navigation/elements',
      'react-native-screens',
      'react-native-safe-area-context',
      'react-native-svg',
      'use-latest-callback',
      'nanoid/non-secure',
      'nanoid',
      'warn-once',
      'react-freeze',
      'lucide-react-native',
      '@tanstack/react-query',
      '@react-native-async-storage/async-storage',
      '@sentry/browser',
      'posthog-js',
    ],
    force: true,
  },
});
