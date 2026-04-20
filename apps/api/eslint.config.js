// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

/**
 * ESLint v9 flat config. Kept intentionally minimal — just enough to
 * catch the category of errors that tsc --noEmit misses:
 *
 *   - accidental `any` from untyped imports
 *   - unused variables that leak into the diff
 *   - `let` where `const` would do
 *
 * The goal here is NOT to impose a house style. Prettier can handle
 * formatting, and stylistic rules (comma-dangle, quote-props, etc)
 * produce PR noise far in excess of their value. If you want a rule
 * added, add it in a dedicated PR with a short rationale so future
 * readers can tell the difference between "this caught a real bug"
 * and "this was added on a Tuesday".
 */
module.exports = tseslint.config(
  {
    // Global ignores — apply before any other config.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'prisma/schema/migrations/**',
      '.turbo/**',
      '*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // Lots of framework patterns legitimately use `any` at the
      // boundary (Express Request augmentation, Prisma JSON columns).
      // Warn not error — keeps the noise down while flagging hotspots.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_`-prefixed args are intentionally unused (signature match).
      //
      // Started life as 'error' but the codebase has ~20 legitimate
      // hits today (unused imports from refactors that never got
      // swept). They're all low-stakes; a follow-up cleanup pass can
      // bump this back to 'error' once the backlog is drained. Left
      // as 'warn' so the rule still surfaces in IDE gutters and
      // pre-commit hooks without blocking CI on day one.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Empty object type (`{}`) shows up in a few controller DTOs
      // for endpoints that genuinely take no body. Downgrade from the
      // preset default.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Same story as no-unused-vars — ~15 legitimate errors in
      // existing regex literals (\-, \/ inside char classes). Not a
      // correctness bug, just noise. Bump to 'error' once cleaned.
      'no-useless-escape': 'warn',
      // Prefer const — pure lint win, no style opinion.
      'prefer-const': 'error',
    },
  },
  {
    // Tests can be more permissive — many unit tests build mock
    // objects shaped like `as any` to poke at private state.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
