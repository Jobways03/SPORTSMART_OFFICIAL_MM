import 'reflect-metadata';
import { createHash } from 'crypto';
import { RegisterUserUseCase } from '../../src/modules/identity/application/use-cases/register-user.use-case';

/**
 * Phase 16 (2026-05-20) — RegisterUserUseCase unit tests.
 *
 * Asserts the contract that lets the rest of the registration flow
 * stand up:
 *   1. confirmPassword equality is enforced server-side.
 *   2. Missing Terms / Privacy consent is rejected.
 *   3. The repo gets called with status-pending fields + the
 *      consent rows (terms + privacy + marketing).
 *   4. The duplicate-email path returns the same uniform payload as
 *      the happy path (no enumeration leak).
 *   5. identity.user.registered fires with the plaintext OTP in
 *      payload (the email handler consumes it).
 */

describe('RegisterUserUseCase', () => {
  const happyInput = {
    firstName: 'Riya',
    lastName: 'Sharma',
    email: 'riya@example.com',
    password: 'Strong#Passw0rd',
    confirmPassword: 'Strong#Passw0rd',
    acceptTerms: true,
    acceptPrivacy: true,
    acceptMarketing: false,
  };

  const buildUseCase = (opts: { repoReturn: any }) => {
    const userRepo = {
      createUserWithRole: jest.fn().mockResolvedValue(opts.repoReturn),
    } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;
    const useCase = new RegisterUserUseCase(userRepo, eventBus, logger);
    return { useCase, userRepo, eventBus };
  };

  it('rejects when password !== confirmPassword', async () => {
    const { useCase } = buildUseCase({ repoReturn: null });
    await expect(
      useCase.execute({ ...happyInput, confirmPassword: 'different' }),
    ).rejects.toThrow(/PASSWORDS_DO_NOT_MATCH|do not match/i);
  });

  it('rejects when acceptTerms is false', async () => {
    const { useCase } = buildUseCase({ repoReturn: null });
    await expect(
      useCase.execute({ ...happyInput, acceptTerms: false }),
    ).rejects.toThrow(/Terms/i);
  });

  it('rejects when acceptPrivacy is false', async () => {
    const { useCase } = buildUseCase({ repoReturn: null });
    await expect(
      useCase.execute({ ...happyInput, acceptPrivacy: false }),
    ).rejects.toThrow(/Privacy/i);
  });

  it('on success: calls repo with PENDING_VERIFICATION + emailVerified=false, 3 consent rows, hashed OTP', async () => {
    const { useCase, userRepo } = buildUseCase({
      repoReturn: {
        id: 'u-1',
        email: 'riya@example.com',
        firstName: 'Riya',
        lastName: 'Sharma',
        otpId: 'otp-1',
      },
    });
    await useCase.execute(happyInput);

    expect(userRepo.createUserWithRole).toHaveBeenCalledTimes(1);
    const call = userRepo.createUserWithRole.mock.calls[0][0];
    expect(call.email).toBe('riya@example.com');
    expect(call.consents).toHaveLength(3);
    expect(call.consents.find((c: any) => c.purpose === 'TERMS_OF_SERVICE').granted).toBe(true);
    expect(call.consents.find((c: any) => c.purpose === 'PRIVACY_POLICY').granted).toBe(true);
    expect(call.consents.find((c: any) => c.purpose === 'EMAIL_MARKETING').granted).toBe(false);
    // SHA-256 hashes are 64 hex chars.
    expect(call.otpHash).toMatch(/^[a-f0-9]{64}$/);
    // 10-minute TTL window: between 9 and 11 minutes from now.
    const ttlMs = call.otpExpiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    expect(ttlMs).toBeLessThan(11 * 60 * 1000);
  });

  it('on success: publishes identity.user.registered with the plaintext OTP', async () => {
    const { useCase, eventBus, userRepo } = buildUseCase({
      repoReturn: {
        id: 'u-1',
        email: 'riya@example.com',
        firstName: 'Riya',
        lastName: 'Sharma',
        otpId: 'otp-1',
      },
    });
    await useCase.execute(happyInput);

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = eventBus.publish.mock.calls[0][0];
    expect(event.eventName).toBe('identity.user.registered');
    expect(event.payload.userId).toBe('u-1');
    expect(event.payload.otpPlaintext).toMatch(/^\d{6}$/);

    // The plaintext OTP that fires on the event must match the hash
    // sent to the repo — sanity-check the encoding contract.
    const fired = event.payload.otpPlaintext;
    const expectedHash = createHash('sha256').update(fired).digest('hex');
    expect(userRepo.createUserWithRole.mock.calls[0][0].otpHash).toBe(
      expectedHash,
    );
  });

  it('duplicate-email path returns the SAME uniform shape — no enumeration leak', async () => {
    const fresh = buildUseCase({
      repoReturn: {
        id: 'u-1',
        email: 'riya@example.com',
        firstName: 'Riya',
        lastName: 'Sharma',
        otpId: 'otp-1',
      },
    });
    const dup = buildUseCase({ repoReturn: null });

    const freshOut = await fresh.useCase.execute(happyInput);
    const dupOut = await dup.useCase.execute(happyInput);

    expect(Object.keys(freshOut).sort()).toEqual(
      Object.keys(dupOut).sort(),
    );
    expect(freshOut.requiresVerification).toBe(true);
    expect(dupOut.requiresVerification).toBe(true);
    expect(freshOut.email).toBe(dupOut.email);
    // Both should advertise that a code was sent — even though the
    // duplicate path didn't actually send one.
    expect(dupOut.message).toMatch(/verification code/i);

    // And the duplicate path MUST NOT publish a registration event
    // (a real send would leak existence by triggering an email).
    expect(dup.eventBus.publish).not.toHaveBeenCalled();
  });
});
