#!/usr/bin/env node
// Fresh-clone bring-up helper for Sportsmart.
//
// Idempotent and safe to re-run. Uses only Node built-ins so it works
// even before `pnpm install` runs.
//
//   pnpm setup
//
// What it does (in order):
//   1. Validates Node + pnpm versions against root package.json `engines`.
//   2. Checks Postgres (5432) and Redis (6379) reachability via TCP probe.
//   3. Copies .env.example → .env in apps/api and apps/web-* if .env missing
//      (never overwrites an existing .env).
//   4. Runs `pnpm install`.
//   5. Generates the Prisma client.
//   6. Prints next-step commands (the script intentionally does NOT run
//      migrations or seeds — those touch the DB and the operator should
//      see the prompt at least once).

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

let failures = 0;
let warnings = 0;

function pass(msg) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function warn(msg) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
  warnings++;
}
function fail(msg) {
  console.log(`  ${RED}✗${RESET} ${msg}`);
  failures++;
}
function section(title) {
  console.log(`\n${BOLD}${CYAN}${title}${RESET}`);
}

// ── 1. Node + pnpm versions ─────────────────────────────────────────────
section('Prerequisites');

const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor >= 22) {
  pass(`Node ${process.versions.node} (>=22 required)`);
} else {
  fail(`Node ${process.versions.node} — need >=22. Install via nvm: \`nvm install 22\``);
}

const pnpmCheck = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
if (pnpmCheck.status === 0) {
  const pnpmVersion = pnpmCheck.stdout.trim();
  const pnpmMajor = parseInt(pnpmVersion.split('.')[0], 10);
  if (pnpmMajor >= 10) {
    pass(`pnpm ${pnpmVersion} (>=10 required)`);
  } else {
    fail(`pnpm ${pnpmVersion} — need >=10. Run \`corepack enable && corepack prepare pnpm@10.0.0 --activate\``);
  }
} else {
  fail('pnpm not found on PATH. Run `corepack enable` (Node 22 ships with corepack).');
}

// ── 2. Postgres + Redis reachability ────────────────────────────────────
section('Local services');

function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolveProbe) => {
    const sock = createConnection({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolveProbe(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.once('timeout', () => done(false));
  });
}

const pgUp = await tcpProbe('localhost', 5432);
if (pgUp) {
  pass('Postgres reachable on localhost:5432');
} else {
  warn('Postgres NOT reachable on localhost:5432. Start it with: `docker compose -f infra/docker/docker-compose.yml up -d postgres` OR `brew services start postgresql@16`');
}

const redisUp = await tcpProbe('localhost', 6379);
if (redisUp) {
  pass('Redis reachable on localhost:6379');
} else {
  warn('Redis NOT reachable on localhost:6379. Start it with: `docker compose -f infra/docker/docker-compose.yml up -d redis` OR `brew services start redis`');
}

// ── 3. Bootstrap .env files ─────────────────────────────────────────────
section('Environment files');

const envTargets = [
  { dir: join(repoRoot, 'apps', 'api'), label: 'apps/api' },
  ...readdirSync(join(repoRoot, 'apps'))
    .filter((name) => name.startsWith('web-'))
    .map((name) => ({ dir: join(repoRoot, 'apps', name), label: `apps/${name}` })),
];

for (const { dir, label } of envTargets) {
  const envPath = join(dir, '.env');
  const examplePath = join(dir, '.env.example');
  if (!existsSync(examplePath)) {
    warn(`${label}/.env.example missing — skipping`);
    continue;
  }
  if (existsSync(envPath)) {
    pass(`${label}/.env exists (kept as-is)`);
  } else {
    copyFileSync(examplePath, envPath);
    pass(`${label}/.env created from .env.example`);
  }
}

// ── 4. pnpm install ─────────────────────────────────────────────────────
section('Install dependencies');

const install = spawnSync('pnpm', ['install'], { stdio: 'inherit', cwd: repoRoot });
if (install.status === 0) {
  pass('Dependencies installed');
} else {
  fail('`pnpm install` failed — stop here and fix the error above.');
}

// ── 5. Prisma generate ──────────────────────────────────────────────────
section('Prisma client');

if (failures === 0) {
  const gen = spawnSync(
    'pnpm',
    ['--filter', '@sportsmart/api', 'prisma:generate'],
    { stdio: 'inherit', cwd: repoRoot },
  );
  if (gen.status === 0) {
    pass('Prisma client generated');
  } else {
    fail('Prisma client generation failed');
  }
} else {
  warn('Skipping Prisma generate because install failed');
}

// ── Summary + next steps ────────────────────────────────────────────────
section('Summary');

if (failures > 0) {
  console.log(`\n${RED}${BOLD}Setup blocked — ${failures} failure(s), ${warnings} warning(s).${RESET}`);
  console.log('Fix the failures above and re-run `pnpm setup`.\n');
  process.exit(1);
}

if (warnings > 0) {
  console.log(`\n${YELLOW}${BOLD}Setup complete with ${warnings} warning(s).${RESET}`);
  console.log('Start Postgres + Redis before continuing.\n');
} else {
  console.log(`\n${GREEN}${BOLD}Setup complete.${RESET}\n`);
}

console.log(`${BOLD}Next steps:${RESET}`);
console.log('  1. Edit apps/api/.env — set DATABASE_URL, JWT_*_SECRET, etc.');
console.log('  2. Create the database:');
console.log('       createdb sportsmart_dev');
console.log('  3. Apply migrations + seed:');
console.log('       pnpm db:setup');
console.log('  4. Start everything:');
console.log('       pnpm dev');
console.log('\n  API:        http://localhost:8000');
console.log('  Storefront: http://localhost:4005');
console.log('  Admin SF:   http://localhost:4000');
console.log('  Admin:      http://localhost:4001');
console.log('  (and 5 more — see README.md)\n');
