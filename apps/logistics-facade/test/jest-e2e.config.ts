import type { Config } from 'jest';
import { resolve } from 'node:path';

/**
 * Jest config for the facade's end-to-end smoke + integration suites.
 *
 * Follows the same shape as apps/api/test/jest-e2e.json: rootDir set
 * to the package root, single worker (Nest test app port collisions),
 * and a private tsconfig override so ts-jest can compile the
 * Nest-decorated source files outside the main build pipeline.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: resolve(__dirname, '..'),
  roots: ['<rootDir>/test/e2e'],
  testRegex: '\\.e2e-spec\\.ts$',
  maxWorkers: 1,
  setupFilesAfterEach: undefined,
  setupFiles: ['<rootDir>/test/setup.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          strictPropertyInitialization: false,
          skipLibCheck: true,
          baseUrl: '.',
          paths: {
            '@src/*': ['src/*'],
            '@core/*': ['src/core/*'],
            '@bootstrap/*': ['src/bootstrap/*'],
            '@modules/*': ['src/modules/*'],
            '@integrations/*': ['src/integrations/*'],
          },
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
  transformIgnorePatterns: ['/node_modules/'],
  passWithNoTests: false,
  verbose: false,
};

export default config;
