import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 10 (PR 10.1) — Admin MFA Prisma schema invariants.
//
// PR 10.1 adds the columns the MFA flow needs (enrollment handshake +
// live secret + enrolled-at timestamp + backup-code hashes). The
// schema change is reviewable and migration-ready in this PR; the
// enrollment endpoint that consumes them lands in PR 10.2.
//
// This spec asserts the column-presence invariants so a future PR
// renaming or dropping a column trips CI immediately. Same shape as
// the env-example completeness spec: read the schema as text, regex
// for known column names within the Admin model block.
//
// Why text-grep over a Prisma DMMF inspection: the DMMF requires
// `prisma generate` to have run, which the unit-test runner doesn't
// guarantee. The schema file is the source of truth; checking it
// directly survives a stale generated client.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'prisma', 'schema', 'admin.prisma');

const REQUIRED_MFA_FIELDS = [
  'mfaSecretCiphertext',
  'mfaPendingSecretCiphertext',
  'mfaEnabledAt',
  'mfaBackupCodesHashes',
  // PR 10.7 — anti-replay column. Stores the most recently
  // accepted TOTP step number; the verifier rejects codes for
  // step <= mfaLastUsedStep.
  'mfaLastUsedStep',
];

function extractAdminModelBody(): string {
  const text = fs.readFileSync(SCHEMA_PATH, 'utf8');
  // Match `model Admin { ... }` — the body between the braces.
  const m = text.match(/model\s+Admin\s*\{([\s\S]*?)\n\}/);
  if (!m || !m[1]) {
    throw new Error(
      'Could not find `model Admin { ... }` in admin.prisma. ' +
        "The schema may have been refactored; update this spec's extraction logic.",
    );
  }
  return m[1];
}

describe('Admin MFA schema invariants (PR 10.1)', () => {
  let adminBody: string;

  beforeAll(() => {
    adminBody = extractAdminModelBody();
  });

  describe.each(REQUIRED_MFA_FIELDS)('%s', (field) => {
    it('is declared on the Admin model', () => {
      // Match the field name as a token followed by whitespace —
      // ensures we don't get a substring match on a different field
      // that happens to share a prefix.
      const re = new RegExp(`\\b${field}\\b\\s+\\S`);
      const present = re.test(adminBody);
      if (!present) {
        throw new Error(
          `Admin model is missing required MFA field \`${field}\`. ` +
            `Phase 10 enrollment / verification flows depend on this column being present.`,
        );
      }
      expect(present).toBe(true);
    });
  });

  it('mfaSecretCiphertext is declared as nullable', () => {
    // Pre-enrollment, every admin has null here. Required-not-null
    // would prevent the migration from running against existing rows.
    expect(adminBody).toMatch(/mfaSecretCiphertext\s+String\?/);
  });

  it('mfaEnabledAt is declared as nullable DateTime', () => {
    expect(adminBody).toMatch(/mfaEnabledAt\s+DateTime\?/);
  });

  it('mfaBackupCodesHashes is declared as nullable Json', () => {
    expect(adminBody).toMatch(/mfaBackupCodesHashes\s+Json\?/);
  });

  it('mfaLastUsedStep is declared as nullable Int', () => {
    expect(adminBody).toMatch(/mfaLastUsedStep\s+Int\?/);
  });
});
