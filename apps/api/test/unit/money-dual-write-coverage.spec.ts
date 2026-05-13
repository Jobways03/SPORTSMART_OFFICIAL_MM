import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { MONEY_FIELD_REGISTRY } from '../../src/core/money/money-field-registry';

/**
 * Phase 7 (PR 7.2) — Money dual-write call-site coverage invariant.
 *
 * The audit at PR 7.1 close found 127 prisma write call sites against
 * money-bearing models, and exactly zero of them routed through
 * `MoneyDualWriteHelper.applyPaise`. The helper exists, the env flag
 * forces it on in prod (PR 7.1), but no service actually invokes it.
 *
 * Wiring 127 sites in a single PR is too much. This spec codifies the
 * current state as a per-model allowlist of "known gaps" and asserts:
 *
 *   1. The current count of uncovered prisma writes per model EXACTLY
 *      matches the allowlist baseline. Phase 7 progresses by shrinking
 *      the baseline as PRs wire individual modules. The spec fails if
 *      a number goes up (new uncovered code) OR if a number goes down
 *      without the allowlist being updated (silently masking progress
 *      makes future PRs hard to reason about).
 *
 *   2. The current per-file breakdown of gaps is logged at run time so
 *      the next PR has a concrete target list.
 *
 * Detection heuristic (refined in PR 7.3 to count only real-risk sites):
 *   - Scan every `*.ts` under `src/` (excluding tests, the helper
 *     itself, generated files).
 *   - For each line matching `prisma.<modelKey>.<method>(` where
 *     method ∈ { create, createMany, update, updateMany, upsert },
 *     check the next ~60 lines for ANY of the model's Decimal field
 *     names from MONEY_FIELD_REGISTRY appearing as an object key.
 *     If none appear, the call is treated as a status-only write and
 *     skipped (no dual-write needed — the helper would no-op anyway).
 *   - For sites that DO reference a money field, look backwards 15
 *     lines for `applyPaise(` or `applyPaiseMany(` to determine if
 *     the site already routes through the helper.
 *
 * The PR 7.2 baseline counted all prisma writes; PR 7.3 refines to
 * count only sites whose data block actually writes a Decimal money
 * column. This makes the baseline a true measure of risk: a site
 * that drops below the threshold because it stopped writing a money
 * field is genuinely lower-risk, and the spec stops nagging.
 *
 * False negatives: a payload built in a helper function elsewhere
 * (e.g. `const data = buildReturnPatch(...)` then `prisma.return.update({ data })`)
 * shows as covered if the field doesn't appear within the inspection
 * window. Phase 7 PRs addressing these add an explicit local
 * `applyPaise` call to surface the route.
 */

interface CallSite {
  file: string;    // relative to apps/api/src/
  line: number;
  model: string;
  method: string;
}

const SRC_ROOT = path.join(__dirname, '..', '..', 'src');
const MODELS = Object.keys(MONEY_FIELD_REGISTRY);
const WRITE_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
] as const;

const COVERED_LOOKBACK_LINES = 15;
const COVERED_LOOKAHEAD_LINES = 60;
const DATA_LOOKAHEAD_LINES = 60;
const PRISMA_VAR_NAMES = ['prisma', 'tx', 'client', 'this\\.prisma']; // common idents

// Phase 7 baseline — counts only sites whose data payload references
// a Decimal money field for the model (PR 7.3 refinement). Each PR
// after this MUST update the relevant entries downward as it wires
// new call sites through the helper.
const PHASE_7_BASELINE: Readonly<Record<string, number>> = {
  // PR 7.8 — final wiring (orders-public.facade.ts subOrder×4).
  // All 14 registry models are at zero gaps. The dual-write coverage
  // invariant is mechanically complete; Phase 7's remaining work is
  // the historical-row backfill cron and the read-shadow flag (ADR-007
  // steps 3 + 4), which are separate concerns from this spec.
  return: 0,
  returnItem: 0,
  refundTransaction: 0,
  masterOrder: 0,
  subOrder: 0,
  orderItem: 0,
  settlementCycle: 0,
  sellerSettlement: 0,
  settlementAdjustment: 0,
  commissionSetting: 0,
  commissionRecord: 0,
  commissionReversalRecord: 0,
  codDecisionLog: 0,
  payout: 0,
};

function listSourceFiles(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      listSourceFiles(full, out);
    } else if (e.isFile() && full.endsWith('.ts')) {
      if (full.endsWith('.spec.ts') || full.endsWith('.test.ts')) continue;
      // Skip the helper itself and the registry — those are the
      // definitional files and reference applyPaise without invoking
      // prisma directly. Skip the money module's own internals.
      if (full.includes(path.sep + 'core' + path.sep + 'money' + path.sep)) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

function findGaps(files: string[]): CallSite[] {
  const gaps: CallSite[] = [];
  // One regex that matches all (prismaVar).<model>.<method>(
  // Capture the model and method so we attribute correctly.
  const modelGroup = MODELS.join('|');
  const methodGroup = WRITE_METHODS.join('|');
  const prismaGroup = PRISMA_VAR_NAMES.join('|');
  const callRe = new RegExp(
    `\\b(?:${prismaGroup})\\.(${modelGroup})\\.(${methodGroup})\\s*\\(`,
    'g',
  );
  // Covered if any line within the coverage window references either
  // `applyPaise(`, `applyPaiseMany(`, or `toPaise(`. The first two
  // are the standard helper. `toPaise` is the lower-level conversion
  // the helper wraps internally — it's the correct call for the
  // increment-operator pattern (the helper only supports `set:`, so
  // for `{ increment: N }` writes the caller has to compute the
  // paise increment manually via toPaise to keep the siblings in
  // lockstep). Both are valid evidence of dual-write awareness.
  const coverRe = /\b(?:applyPaise(?:Many)?|toPaise)\s*\(/;

  // Build per-model regex matching any Decimal money field name as a
  // property key. Matches `refundAmount:` or `"refundAmount":` etc.
  const moneyFieldReByModel: Record<string, RegExp> = {};
  for (const model of MODELS) {
    const pairs = MONEY_FIELD_REGISTRY[model] ?? [];
    if (pairs.length === 0) continue;
    const names = pairs.map((p) => p.decimal).join('|');
    moneyFieldReByModel[model] = new RegExp(
      `(?:^|[\\s,{])(?:${names})\\s*:`,
      'm',
    );
  }

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    callRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text)) !== null) {
      // Compute 1-indexed line number of the match position.
      const upto = text.slice(0, m.index);
      const lineIdx = upto.split('\n').length - 1;
      const lineNo = lineIdx + 1;
      const model = m[1];
      const method = m[2];

      // Refinement (PR 7.3): the data payload must mention at least
      // one Decimal money field for the model. Status-only writes
      // don't need dual-write and the helper would no-op.
      const fieldRe = moneyFieldReByModel[model];
      if (!fieldRe) continue; // model with no Decimal pairs — exempt
      const ahead = lines
        .slice(lineIdx, lineIdx + DATA_LOOKAHEAD_LINES)
        .join('\n');
      if (!fieldRe.test(ahead)) continue; // status-only write

      // Coverage window: look both backwards (variable-extracted
      // pattern: `const data = applyPaise(...); prisma.x.update({ data })`)
      // AND forwards (inline-arg pattern, preserves TS literal-type
      // narrowing: `prisma.x.update({ data: applyPaise(...) })`).
      const fromIdx = Math.max(0, lineIdx - COVERED_LOOKBACK_LINES);
      const toIdx = Math.min(lines.length, lineIdx + COVERED_LOOKAHEAD_LINES);
      const window = lines.slice(fromIdx, toIdx).join('\n');
      const covered = coverRe.test(window);
      if (!covered) {
        gaps.push({
          file: path.relative(SRC_ROOT, file),
          line: lineNo,
          model,
          method,
        });
      }
    }
  }
  return gaps;
}

describe('Money dual-write coverage invariant (PR 7.2 — refined in 7.3)', () => {
  const files = listSourceFiles(SRC_ROOT);
  const gaps = findGaps(files);

  // Aggregate per-model gap count.
  const gapsByModel: Record<string, number> = {};
  for (const m of MODELS) gapsByModel[m] = 0;
  for (const g of gaps) gapsByModel[g.model] += 1;

  describe.each(MODELS)('%s', (model) => {
    const baseline = PHASE_7_BASELINE[model] ?? 0;
    it(`current gap count matches the Phase-7 allowlist (${baseline})`, () => {
      // Exact equality: each subsequent PR must update the baseline
      // downward as it wires new sites. A PR that adds new uncovered
      // code makes the actual count go up and trips this assertion.
      expect(gapsByModel[model]).toBe(baseline);
    });
  });

  it('every PHASE_7_BASELINE entry corresponds to a registered model', () => {
    const unknown = Object.keys(PHASE_7_BASELINE).filter(
      (k) => !MONEY_FIELD_REGISTRY[k],
    );
    expect(unknown).toEqual([]);
  });

  it('exposes the per-file breakdown so the next PR has a concrete target list', () => {
    // Not a hard assertion — surface the per-file map via console.log
    // so each spec run shows the Phase-7 remaining work. Skips when
    // the suite is silenced; helpful when run directly.
    const byFile = new Map<string, Map<string, number>>();
    for (const g of gaps) {
      const perFile = byFile.get(g.file) ?? new Map<string, number>();
      perFile.set(g.model, (perFile.get(g.model) ?? 0) + 1);
      byFile.set(g.file, perFile);
    }
    // Materialise into a sorted array to make the log deterministic.
    const sorted = [...byFile.entries()]
      .map(([file, perFile]) => ({
        file,
        models: Object.fromEntries(perFile),
        total: [...perFile.values()].reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);
    if (process.env.MONEY_DUAL_WRITE_REPORT === 'true') {
      // eslint-disable-next-line no-console
      console.log('Phase 7 dual-write per-file gap map:\n', JSON.stringify(sorted, null, 2));
      // eslint-disable-next-line no-console
      console.log('Phase 7 dual-write raw gap list:\n', JSON.stringify(gaps, null, 2));
    }
    expect(sorted.length).toBeGreaterThanOrEqual(0);
  });
});
