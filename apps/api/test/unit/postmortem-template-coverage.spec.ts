import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 11 (PR 11.5) — Postmortem template coverage.
 *
 * `incident-response.md` references `docs/templates/postmortem.md`
 * as the SEV-1 mandatory artifact. Without that template file in
 * place, the reference is a broken pointer — an Incident Commander
 * needing to start a postmortem at 3am has nothing to copy from.
 *
 * This spec is the standing guard that:
 *   - the template file exists at the referenced path
 *   - it contains the eight required postmortem sections (these are
 *     the lowest-common-denominator across postmortem templates at
 *     comparable platform teams — Summary / Timeline / Impact /
 *     Contributing factors / What we did well / What we'd do
 *     differently / Action items / Runbook updates)
 *   - it contains placeholder markers so authors can tell it's a
 *     template (vs an actual incident report by accident)
 */

const TEMPLATE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'templates',
  'postmortem.md',
);

const REQUIRED_SECTIONS = [
  '## Summary',
  '## Timeline',
  '## Impact',
  '## Contributing factors',
  '## What we did well',
  "## What we'd do differently",
  '## Action items',
  '## Runbook updates needed',
];

const REQUIRED_TEMPLATE_MARKERS = [
  // Authors descend into each section and replace these placeholders;
  // the colon-prefixed form surfaces a hint per slot rather than a
  // bare blank. The substring match is loose (just "<FILL IN:") so a
  // template with many distinct hint texts still passes.
  '<FILL IN:',
];

describe('postmortem template coverage', () => {
  let content: string;

  beforeAll(() => {
    if (!existsSync(TEMPLATE_PATH)) {
      throw new Error(
        `Postmortem template not found at ${TEMPLATE_PATH}. ` +
          'incident-response.md references this path as the canonical ' +
          'template; without it, the reference is broken.',
      );
    }
    content = readFileSync(TEMPLATE_PATH, 'utf8');
  });

  it.each(REQUIRED_SECTIONS)('has required section %s', (section) => {
    const re = new RegExp(
      `^${section.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`,
      'm',
    );
    expect(content).toMatch(re);
  });

  it.each(REQUIRED_TEMPLATE_MARKERS)(
    'contains template marker %s',
    (marker) => {
      // The marker convention signals to authors this is a fill-in
      // template. Without it, someone could accidentally commit the
      // template itself as a real incident report.
      expect(content).toContain(marker);
    },
  );
});
