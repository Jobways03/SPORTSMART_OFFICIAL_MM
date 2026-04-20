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
};
