/**
 * Phase 20 (2026-05-20) — Dashboard banner unit tests.
 *
 * Pure function tests, no React. Run with:
 *   node --test --experimental-strip-types src/lib/dashboard-banner.test.ts
 *
 * The franchise web app has no Jest config; this uses node:test (built
 * into Node 20+) so we don't drag in test infrastructure just for a
 * pure-function helper. The dashboard layout consumes deriveBanner —
 * pinning its priority order means the banner UX cannot regress
 * silently when columns are added or status enums change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveBanner } from './dashboard-banner.ts';

const fr = (overrides: Partial<Parameters<typeof deriveBanner>[0]> = {}) => ({
  email: 'owner@example.com',
  status: 'PENDING',
  verificationStatus: 'NOT_VERIFIED',
  isEmailVerified: false,
  gstNumber: null as string | null,
  panNumber: null as string | null,
  ...overrides,
});

test('unverified email → "verify email" banner (highest priority)', () => {
  // Even with everything else filled, unverified email wins.
  const banner = deriveBanner(
    fr({
      isEmailVerified: false,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'VERIFIED',
      status: 'ACTIVE',
    }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'warning');
  assert.match(banner!.text, /verify your email/i);
  assert.equal(
    banner!.ctaHref,
    '/register/verify?email=owner%40example.com',
  );
});

test('verified email but no GST → submit-KYC banner', () => {
  const banner = deriveBanner(
    fr({ isEmailVerified: true, gstNumber: null, panNumber: 'ABCDE1234F' }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'info');
  assert.match(banner!.text, /Complete your KYC/i);
  assert.equal(banner!.ctaHref, '/dashboard/onboarding');
});

test('verified email but no PAN → submit-KYC banner', () => {
  const banner = deriveBanner(
    fr({ isEmailVerified: true, gstNumber: '29ABCDE1234F1Z5', panNumber: null }),
  );
  assert.ok(banner);
  assert.match(banner!.text, /Complete your KYC/i);
});

test('REJECTED verification → resubmit banner (error kind)', () => {
  const banner = deriveBanner(
    fr({
      isEmailVerified: true,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'REJECTED',
    }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'error');
  assert.match(banner!.text, /rejected/i);
  assert.equal(banner!.ctaHref, '/dashboard/onboarding');
});

test('UNDER_REVIEW verification → info banner, no CTA', () => {
  const banner = deriveBanner(
    fr({
      isEmailVerified: true,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'UNDER_REVIEW',
    }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'info');
  assert.match(banner!.text, /under review/i);
  assert.equal(banner!.ctaHref, undefined);
});

test('VERIFIED + PENDING status → awaiting-admin banner', () => {
  const banner = deriveBanner(
    fr({
      isEmailVerified: true,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'VERIFIED',
      status: 'PENDING',
    }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'info');
  assert.match(banner!.text, /Awaiting admin approval/i);
});

test('APPROVED status → add-bank-details banner', () => {
  const banner = deriveBanner(
    fr({
      isEmailVerified: true,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'VERIFIED',
      status: 'APPROVED',
    }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'warning');
  assert.match(banner!.text, /Add bank details/i);
  assert.equal(banner!.ctaHref, '/dashboard/profile');
});

test('SUSPENDED status → error banner, no CTA', () => {
  const banner = deriveBanner(
    fr({
      isEmailVerified: true,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'VERIFIED',
      status: 'SUSPENDED',
    }),
  );
  assert.ok(banner);
  assert.equal(banner!.kind, 'error');
  assert.match(banner!.text, /suspended/i);
  assert.equal(banner!.ctaHref, undefined);
});

test('happy state (ACTIVE + VERIFIED + KYC + verified email) → no banner', () => {
  const banner = deriveBanner(
    fr({
      isEmailVerified: true,
      gstNumber: '29ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      verificationStatus: 'VERIFIED',
      status: 'ACTIVE',
    }),
  );
  assert.equal(banner, null);
});

test('email is URL-encoded in the verify CTA (handles +, &, =)', () => {
  const banner = deriveBanner(
    fr({ email: 'first+last@example.com', isEmailVerified: false }),
  );
  assert.ok(banner);
  assert.equal(
    banner!.ctaHref,
    '/register/verify?email=first%2Blast%40example.com',
  );
});
