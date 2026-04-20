import 'reflect-metadata';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { LoginController } from '../../src/modules/identity/presentation/controllers/login.controller';
import { ForgotPasswordController } from '../../src/modules/identity/presentation/controllers/forgot-password.controller';
import { ResetPasswordController } from '../../src/modules/identity/presentation/controllers/reset-password.controller';
import { SellerLoginController } from '../../src/modules/seller/presentation/controllers/seller-login.controller';
import { SellerForgotPasswordController } from '../../src/modules/seller/presentation/controllers/seller-forgot-password.controller';
import { SellerResetPasswordController } from '../../src/modules/seller/presentation/controllers/seller-reset-password.controller';
import { AdminAuthController } from '../../src/modules/admin/presentation/controllers/admin-auth.controller';
import { FranchiseAuthController } from '../../src/modules/franchise/presentation/controllers/franchise-auth.controller';

/**
 * Regression test for auth endpoint rate limiting.
 *
 * Before the fix: ThrottlerGuard was never registered via APP_GUARD, so the
 * global throttler config (300/60s) was no-op. An attacker could brute-force
 * login/OTP endpoints indefinitely.
 *
 * After: APP_GUARD binds ThrottlerGuard globally, and each sensitive auth
 * method carries `@Throttle({ default: { limit: 5, ttl: 60_000 } })` so the
 * per-route limit overrides the global one.
 *
 * We cannot boot the HTTP layer in a unit test, but @nestjs/throttler writes
 * reflect-metadata on each decorated method — asserting that metadata is
 * present proves the decorator was applied at build time. Constants come
 * from throttler.constants.ts (see @nestjs/throttler/dist/throttler.decorator.js).
 */

const limitKey = 'THROTTLER:LIMITdefault';
const ttlKey = 'THROTTLER:TTLdefault';

const assertThrottled = (ctor: any, method: string) => {
  const target = ctor.prototype[method];
  const limit = Reflect.getMetadata(limitKey, target);
  const ttl = Reflect.getMetadata(ttlKey, target);
  expect({ method, limit, ttl }).toEqual({
    method,
    limit: 5,
    ttl: 60_000,
  });
};

describe('Auth endpoints — @Throttle decorator', () => {
  it('customer login is throttled', () => assertThrottled(LoginController, 'login'));

  it('customer forgot-password flow is throttled', () => {
    assertThrottled(ForgotPasswordController, 'forgotPassword');
    assertThrottled(ForgotPasswordController, 'verifyResetOtp');
    assertThrottled(ForgotPasswordController, 'resendResetOtp');
  });

  it('customer reset-password is throttled', () =>
    assertThrottled(ResetPasswordController, 'resetPassword'));

  it('seller login is throttled', () => assertThrottled(SellerLoginController, 'login'));

  it('seller forgot-password flow is throttled', () => {
    assertThrottled(SellerForgotPasswordController, 'forgotPassword');
    assertThrottled(SellerForgotPasswordController, 'verifyResetOtp');
    assertThrottled(SellerForgotPasswordController, 'resendResetOtp');
  });

  it('seller reset-password is throttled', () =>
    assertThrottled(SellerResetPasswordController, 'resetPassword'));

  it('admin login + password-reset flow is throttled', () => {
    assertThrottled(AdminAuthController, 'login');
    assertThrottled(AdminAuthController, 'forgotPassword');
    assertThrottled(AdminAuthController, 'verifyResetOtp');
    assertThrottled(AdminAuthController, 'resendResetOtp');
    assertThrottled(AdminAuthController, 'resetPassword');
  });

  it('franchise register + login + password-reset flow is throttled', () => {
    assertThrottled(FranchiseAuthController, 'register');
    assertThrottled(FranchiseAuthController, 'login');
    assertThrottled(FranchiseAuthController, 'forgotPassword');
    assertThrottled(FranchiseAuthController, 'verifyResetOtp');
    assertThrottled(FranchiseAuthController, 'resendResetOtp');
    assertThrottled(FranchiseAuthController, 'resetPassword');
  });
});

describe('SecurityModule — ThrottlerGuard registration', () => {
  it('registers ThrottlerGuard via APP_GUARD so @Throttle metadata is honored', async () => {
    // Dynamic import so we read the module metadata fresh.
    const mod = await import('../../src/bootstrap/security/security.module');
    const providers: any[] =
      Reflect.getMetadata('providers', mod.SecurityModule) || [];

    const appGuardProvider = providers.find(
      (p) => p && typeof p === 'object' && p.provide === APP_GUARD,
    );

    expect(appGuardProvider).toBeDefined();
    expect(appGuardProvider.useClass).toBe(ThrottlerGuard);
  });
});
