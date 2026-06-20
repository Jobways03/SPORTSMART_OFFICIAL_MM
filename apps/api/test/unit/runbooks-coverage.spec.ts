import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 11 (PR 11.1) — Operator-runbook coverage.
 *
 * The capability runbooks under docs/runbooks/ are the operator-
 * facing source of truth for "what to do when the system misbehaves
 * at 2am". Without a coverage guard, a future contributor could
 * delete or thin-out a runbook (or merge a new capability without
 * its runbook) and CI would still pass — operators would only
 * discover the gap mid-incident.
 *
 * Required sections (matched by exact "## <name>" heading) are the
 * lowest-common-denominator across the four pre-existing capability
 * runbooks. They encode the minimum operator-usability bar:
 *
 *   - What it is              — paragraph-level overview
 *   - Operating envelope      — knobs + defaults + recommended values
 *   - Rollback                — how to undo a deploy of this capability
 *   - Test in pre-prod        — concrete recipe an operator can run
 *
 * Style-B phase-cutover runbooks (phase-4-..-phase-10-) follow a
 * different structure (Pre-flight / Flip-N / Common gotchas) and
 * are intentionally NOT in this manifest; they're one-shot
 * documents whose value drops to near-zero once the cutover ships.
 *
 * Adding a new capability runbook: append to MANIFEST below + write
 * the file with all four required sections. The spec then guarantees
 * the runbook can't quietly lose them.
 */

interface RunbookEntry {
  path: string;
  requiredSubstrings?: string[];
}

const REQUIRED_SECTIONS = [
  '## What it is',
  '## Operating envelope',
  '## Rollback',
  '## Test in pre-prod',
];

const MANIFEST: RunbookEntry[] = [
  { path: 'case-duplicate-prevention.md' },
  { path: 'idempotency-keys.md' },
  { path: 'money-paise-migration.md' },
  { path: 'transactional-outbox.md' },
  // PR 11.1 — Phase 10 admin MFA + step-up auth. The content
  // substrings below are the load-bearing operator details: without
  // them the runbook would technically have the right section
  // headings but wouldn't actually answer "how do I rotate the key"
  // or "what do I do when an admin loses their device".
  {
    path: 'admin-mfa.md',
    requiredSubstrings: [
      'ADMIN_MFA_ENCRYPTION_KEY',
      'backup code',
      'step-up',
      'rotation',
      '/admin/mfa/enroll/begin',
      '/admin/mfa/step-up',
      'mfa_secret_ciphertext',
    ],
  },
  // PR 11.2 — Consolidated prod boot-failure diagnostic. The
  // validator (env.schema.ts superRefine) emits a small set of
  // error templates; this runbook keys the operator response to
  // each. Required substrings are the literal error templates the
  // validator emits — if they drift, the runbook stops being a
  // grep-target for an on-call engineer pasting the boot error.
  {
    path: 'prod-boot-failures.md',
    requiredSubstrings: [
      "is required when NODE_ENV=production",
      "must be 'true' when NODE_ENV=production",
      'OUTBOX_AUTHORITATIVE',
      'JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL',
      'CORS_ORIGINS',
      'ADMIN_MFA_ENCRYPTION_KEY',
      'MONEY_DUAL_WRITE_ENABLED',
    ],
  },
  // PR 11.3 — Migration deploy-ordering. Phases 1/2/7/10 each
  // shipped schema changes with implicit ordering constraints
  // (table → code → flag → read-switch). This runbook makes the
  // constraints explicit for a 2am deploy operator. Required
  // substrings are the load-bearing commands + column names + flags
  // that any complete ordering runbook MUST reference.
  {
    path: 'migration-ordering.md',
    requiredSubstrings: [
      'prisma migrate deploy',
      'prisma generate',
      'mfa_secret_ciphertext',
      'step_up_verified_at',
      '_in_paise',
      'outbox_events',
      'OUTBOX_AUTHORITATIVE',
      'MONEY_DUAL_WRITE_ENABLED',
      'backfill',
    ],
  },
  // PR 11.4 — Incident response. The meta-runbook every other
  // capability runbook implicitly references ("page returns-
  // platform", "page platform-security", "this is an SEV-2") without
  // defining. Required substrings are the load-bearing framework
  // pieces: the three SEV levels, the named teams referenced across
  // sibling runbooks, the on-call tool, the incident-command role,
  // and the postmortem artifact.
  {
    path: 'incident-response.md',
    requiredSubstrings: [
      'SEV-1',
      'SEV-2',
      'SEV-3',
      'Incident Commander',
      'platform-security',
      'returns-platform',
      'payments',
      'PagerDuty',
      'postmortem',
    ],
  },
  // Option B — deferred ONLINE order creation. The load-bearing operator
  // details: the master flag, the session table, the materialize entry the
  // webhook/cron call, the reconciler pause flag, the refund-stamp column, and
  // the backstop cron name. If these drift the runbook stops matching the code.
  {
    path: 'deferred-order-creation.md',
    requiredSubstrings: [
      'CHECKOUT_DEFERRED_ORDER_CREATION',
      'checkout_sessions',
      'materializeFromGateway',
      'CHECKOUT_SESSION_RECONCILIATION_ENABLED',
      'refund_reference',
      'deferred-capture-recovery',
    ],
  },
];

const RUNBOOKS_DIR = join(__dirname, '..', '..', '..', '..', 'docs', 'runbooks');

function readRunbook(rel: string): string {
  const full = join(RUNBOOKS_DIR, rel);
  if (!existsSync(full)) {
    throw new Error(
      `Runbook not found: ${rel}. Expected at ${full}. ` +
        `If the runbook moved, update MANIFEST in this spec.`,
    );
  }
  return readFileSync(full, 'utf8');
}

describe('runbooks coverage', () => {
  describe.each(MANIFEST)('$path', (entry) => {
    let content: string;

    beforeAll(() => {
      content = readRunbook(entry.path);
    });

    it.each(REQUIRED_SECTIONS)('has required section %s', (section) => {
      // Match the heading at start of line; tolerate trailing text
      // after the heading name (e.g. "## Symptoms & responses"
      // wouldn't match "## Symptoms" — we require the exact heading).
      const re = new RegExp(`^${section.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'm');
      expect(content).toMatch(re);
    });

    if (entry.requiredSubstrings && entry.requiredSubstrings.length > 0) {
      it.each(entry.requiredSubstrings)('mentions %s', (substring) => {
        expect(content).toContain(substring);
      });
    }
  });

  it('manifest is non-empty', () => {
    // Defensive: if MANIFEST is accidentally emptied, the describe.each
    // above silently registers zero tests and the suite passes. This
    // assertion makes that failure mode loud.
    expect(MANIFEST.length).toBeGreaterThan(0);
  });
});
