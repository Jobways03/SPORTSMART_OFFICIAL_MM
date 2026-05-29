/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Look for tests in both `src` (co-located) and `test` (out-of-tree).
  // Co-located tests are useful for pure-function unit tests; the `test`
  // directory is reserved for integration / e2e tests that span modules.
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.(spec|test)\\.ts$',
  // Keep the unit runner scoped to unit-only files. e2e/integration
  // tests have their own config (test/jest-e2e.json) and a dedicated
  // suffix (*.e2e-spec.ts / *.integration-spec.ts) so running
  // `pnpm test` doesn't pull them in without their setup.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/test/e2e/',
    '<rootDir>/test/integration/',
    '\\.e2e-spec\\.ts$',
    '\\.integration-spec\\.ts$',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // Tests use the same compiler options as src but don't need
          // strict rootDir enforcement.
          target: 'ES2022',
          module: 'commonjs',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          strictPropertyInitialization: false,
          // Production tsconfig keeps noUncheckedIndexedAccess ON (it catches
          // real index bugs in shipped code). Test files index known-shape
          // fixtures constantly (arr[0], match[1]); applying it there only
          // produced compile noise — ~50 committed specs failed to LOAD with
          // no runtime signal. Off for tests only; src strictness is unchanged.
          noUncheckedIndexedAccess: false,
          skipLibCheck: true,
          paths: {
            '@src/*': ['src/*'],
            '@core/*': ['src/core/*'],
            '@bootstrap/*': ['src/bootstrap/*'],
            '@modules/*': ['src/modules/*'],
            '@integrations/*': ['src/integrations/*'],
          },
          baseUrl: '.',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@bootstrap/(.*)$': '<rootDir>/src/bootstrap/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@integrations/(.*)$': '<rootDir>/src/integrations/$1',
  },
  // Don't transform node_modules — speed up first-run.
  transformIgnorePatterns: ['/node_modules/'],
  // Quieter default output.
  verbose: false,

  // Phase 9 (2026-05-16) — coverage settings.
  //
  // `collectCoverage` is FALSE by default so day-to-day `pnpm test`
  // stays fast. CI flips it on via the `--coverage` flag, which
  // overrides this value without needing a parallel config file.
  //
  // collectCoverageFrom enumerates the source files to consider —
  // include all of src/ but exclude barrel files, NestJS modules
  // (mostly DI wiring with no logic to cover), main.ts (boot only),
  // and pure type declarations.
  //
  // coverageThreshold sets the floor. Starting point is conservative
  // (50% lines / 40% branches) so existing PRs don't fail on legacy
  // gaps; ratchet up as tests get added. NEVER ratchet down.
  collectCoverage: false,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      lines: 50,
      statements: 50,
      functions: 50,
      branches: 40,
    },
  },
};
