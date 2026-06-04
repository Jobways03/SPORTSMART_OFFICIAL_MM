import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  passWithNoTests: true,
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/$1',
    '^@core/(.*)$': '<rootDir>/core/$1',
    '^@bootstrap/(.*)$': '<rootDir>/bootstrap/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@integrations/(.*)$': '<rootDir>/integrations/$1',
  },
};

export default config;
