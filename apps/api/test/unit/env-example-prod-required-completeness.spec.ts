import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 9 (PR 9.1, extended in PR 9.2) — apps/api/.env.example must
// list every variable the env schema marks as prod-required.
//
// The schema has TWO independent prod-gate lists, both in the same
// superRefine callback:
//
//   1. requiredOnInProd — boolean flags that must resolve truthy in
//      prod (PR 9.1 covers this). 16 entries as of PR 7.1.
//
//   2. requiredInProd — string secrets that must be present + non-
//      empty in prod (PR 9.2 covers this). 7 entries: Razorpay keys
//      + S3 credentials.
//
// Both are boot-time forcing functions: prod refuses to start
// unless each entry passes its check. The .env.example is the
// deployment-time documentation for the schema; keeping the two in
// sync across both lists is the invariant this spec enforces.
//
// Without it, an operator who copies .env.example into .env for a
// fresh prod deploy hits boot failure with no template guidance and
// a five-step "look up each missing entry in env.schema.ts, paste
// it into .env" loop — exactly the friction the gate was meant to
// eliminate.
//
// Detection strategy: read the schema source, regex-extract both
// blocks, pull each entry, assert each appears as a top-of-line
// `FLAG=...` entry in .env.example.
//
// Why regex over AST: the schema grew naturally through Phase 6 / 7
// and the lists live inside a superRefine callback; navigating the
// callback hierarchy is overkill for the simple textual pattern.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENV_SCHEMA_PATH = path.join(REPO_ROOT, 'src', 'bootstrap', 'env', 'env.schema.ts');
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');

function extractRequiredOnInProdFlags() {
  const text = fs.readFileSync(ENV_SCHEMA_PATH, 'utf8');
  const blockMatch = text.match(
    /const\s+requiredOnInProd\s*:\s*Array<[\s\S]*?=\s*\[([\s\S]*?)\];/,
  );
  if (!blockMatch) {
    throw new Error(
      'Could not find requiredOnInProd array in env.schema.ts. ' +
        "The schema may have been refactored; update this spec's extraction logic.",
    );
  }
  const blockBody = blockMatch[1];
  const keyRe = /key\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g;
  const flags = [];
  let m;
  while ((m = keyRe.exec(blockBody)) !== null) {
    flags.push(m[1]);
  }
  return flags;
}

// PR 9.2 extension — the simpler-shaped list: an array of bare string
// literals (no per-entry object). Pattern is:
//
//   const requiredInProd: Array<keyof typeof env> = [
//     'RAZORPAY_KEY_ID',
//     'S3_BUCKET',
//     ...
//   ];
function extractRequiredInProdSecrets() {
  const text = fs.readFileSync(ENV_SCHEMA_PATH, 'utf8');
  const blockMatch = text.match(
    /const\s+requiredInProd\s*:\s*Array<[^>]+>\s*=\s*\[([\s\S]*?)\];/,
  );
  if (!blockMatch) {
    throw new Error(
      'Could not find requiredInProd array in env.schema.ts. ' +
        "The schema may have been refactored; update this spec's extraction logic.",
    );
  }
  const blockBody = blockMatch[1];
  // Bare string-literal entries: 'NAME' or "NAME".
  const entryRe = /['"]([A-Z][A-Z0-9_]+)['"]/g;
  const secrets = [];
  let m;
  while ((m = entryRe.exec(blockBody)) !== null) {
    secrets.push(m[1]);
  }
  return secrets;
}

function envExampleKeys() {
  const text = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const keys = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z][A-Z0-9_]+)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

describe('apps/api/.env.example must list every prod-required-on flag (PR 9.1)', () => {
  const declaredFlags = extractRequiredOnInProdFlags();
  const exampleKeys = envExampleKeys();

  it('extracted at least one flag from env.schema.ts (sanity)', () => {
    expect(declaredFlags.length).toBeGreaterThan(0);
  });

  describe.each(declaredFlags)('%s', (flag) => {
    it('is present as a top-line entry in .env.example', () => {
      const present = exampleKeys.has(flag);
      if (!present) {
        throw new Error(
          `${flag} is marked requiredOnInProd in env.schema.ts but is not present as a top-line entry in apps/api/.env.example. ` +
            `An operator copying .env.example would hit boot-time failure with no template guidance. ` +
            `Add a "${flag}=false" line in .env.example with a comment explaining the flag's purpose.`,
        );
      }
      expect(present).toBe(true);
    });
  });

  it('exposes the full prod-required flag list for diagnostic / future-PR targeting', () => {
    if (process.env.ENV_REQUIRED_FLAGS_REPORT === 'true') {
      // eslint-disable-next-line no-console
      console.log(
        'Phase 9 prod-required flags discovered in env.schema.ts:\n',
        JSON.stringify(declaredFlags, null, 2),
      );
    }
    expect(declaredFlags.length).toBeGreaterThanOrEqual(1);
  });

  // PR 9.2 — sibling check for the `requiredInProd` list (string
  // secrets that must be non-empty in prod).
  describe('requiredInProd secrets', () => {
    const declaredSecrets = extractRequiredInProdSecrets();

    it('extracted at least one secret from env.schema.ts (sanity)', () => {
      expect(declaredSecrets.length).toBeGreaterThan(0);
    });

    describe.each(declaredSecrets)('%s', (secret) => {
      it('is present as a top-line entry in .env.example', () => {
        const present = exampleKeys.has(secret);
        if (!present) {
          throw new Error(
            `${secret} is marked requiredInProd in env.schema.ts but is not present as a top-line entry in apps/api/.env.example. ` +
              `An operator copying .env.example into a fresh prod .env would hit boot failure with no template guidance. ` +
              `Add a "${secret}=" line (empty value, prod-fill-required) in .env.example with a comment explaining the secret.`,
          );
        }
        expect(present).toBe(true);
      });
    });
  });
});
