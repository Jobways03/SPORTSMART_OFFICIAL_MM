import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// Phase 9 (PR 9.4) — Every Dockerfile in the repo must pin its base
// image(s) by SHA256 digest, not just by tag.
//
// `FROM node:22-slim` resolves to whichever image upstream has
// currently published for that tag. Mutable tags are a known supply-
// chain vector: a malicious republish (or a less-malicious "the
// maintainer rebuilt with a regression") substitutes silently into
// every container build the next time CI pulls. `FROM node:22-slim
// @sha256:...` makes the image bits part of the source — a tampered
// upstream produces a build-time pull failure (the digest no longer
// matches) instead of a runtime surprise.
//
// Detection strategy:
//   - Walk the whole repo (skipping node_modules / build output) for
//     *.Dockerfile / Dockerfile / Dockerfile.* files — so app-level
//     Dockerfiles (e.g. apps/logistics-facade/Dockerfile) are covered,
//     not just the ones under infra/.
//   - For each, find every non-commented `FROM <image>[ AS <stage>]`
//     line.
//   - Assert each FROM image contains `@sha256:<64 hex chars>`.
//
// Format-only validation: this spec confirms the digest IS pinned and
// the syntax is valid. It does NOT verify the digest resolves at the
// registry — that's the deploy-time concern (a CI `docker build`
// against the pinned digest will surface a 404 if the digest was
// fabricated or the image was un-published).

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Directories that never hold our first-party Dockerfiles and would either
// slow the walk or surface third-party / build-output Dockerfiles we don't own.
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);

function findDockerfiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (
        e.name === 'Dockerfile' ||
        e.name.startsWith('Dockerfile.') ||
        e.name.endsWith('.Dockerfile')
      ) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function extractFromLines(text: string): Array<{ lineNo: number; image: string }> {
  // FROM <image>[@sha256:...] [AS <stage>]
  // Skip commented lines (leading whitespace + #).
  //
  // Multi-stage builds reference previous local stages by bare name
  // (e.g. `FROM base AS runtime`). Those don't need digest pinning —
  // the local stage is itself derived from a pinned upstream — so we
  // track stage names and exempt FROM lines that reference a known
  // stage rather than a registry image.
  const lines = text.split('\n');
  const froms: Array<{ lineNo: number; image: string }> = [];
  const knownStages = new Set<string>();
  const fromRe = /^\s*FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/^\s+/, '');
    if (stripped.startsWith('#')) continue;
    const m = line.match(fromRe);
    if (!m) continue;
    const image = m[1];
    const stage = m[2];
    if (stage) knownStages.add(stage);
    if (knownStages.has(image)) continue; // local stage reference
    froms.push({ lineNo: i + 1, image });
  }
  return froms;
}

describe('Every Dockerfile in the repo pins its base image by SHA256 digest (PR 9.4)', () => {
  const dockerfiles = findDockerfiles(REPO_ROOT);

  it('discovers at least one Dockerfile in the repo (sanity)', () => {
    expect(dockerfiles.length).toBeGreaterThan(0);
  });

  describe.each(dockerfiles)('%s', (file: string) => {
    let text: string;
    let froms: Array<{ lineNo: number; image: string }>;
    beforeAll(() => {
      text = fs.readFileSync(file, 'utf8');
      froms = extractFromLines(text);
    });

    it('contains at least one FROM directive', () => {
      expect(froms.length).toBeGreaterThan(0);
    });

    it('every FROM image is pinned to a 64-hex SHA256 digest', () => {
      const unpinned = froms.filter(
        (f) => !/@sha256:[0-9a-fA-F]{64}\b/.test(f.image),
      );
      if (unpinned.length > 0) {
        const detail = unpinned
          .map((f) => `  line ${f.lineNo}: ${f.image}`)
          .join('\n');
        throw new Error(
          `${file} has FROM lines without a SHA256 digest pin:\n${detail}\n` +
            `Tag-only references are mutable — pin via "image@sha256:<64-hex>" so a republished upstream image is detected as a build failure rather than silently substituted.`,
        );
      }
      expect(unpinned).toEqual([]);
    });
  });

  it('exposes the per-Dockerfile FROM map for diagnostic', () => {
    if (process.env.DOCKERFILE_DIGEST_REPORT === 'true') {
      const map: Record<string, Array<{ lineNo: number; image: string }>> = {};
      for (const f of dockerfiles) {
        map[path.relative(REPO_ROOT, f)] = extractFromLines(
          fs.readFileSync(f, 'utf8'),
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        'Dockerfile digest-pin report:\n',
        JSON.stringify(map, null, 2),
      );
    }
    expect(dockerfiles.length).toBeGreaterThanOrEqual(1);
  });
});
