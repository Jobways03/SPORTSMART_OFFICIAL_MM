import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import {
  RequiresStepUp,
  REQUIRES_STEP_UP_METADATA_KEY,
} from '../../src/core/step-up/requires-step-up.decorator';
import { StepUpGuard } from '../../src/core/step-up/step-up.guard';
import { AdminMfaService } from '../../src/modules/admin-mfa/application/services/admin-mfa.service';
import { MfaSecretCipher } from '../../src/modules/admin-mfa/application/services/mfa-secret-cipher.service';
import { generateTotpSecret } from '../../src/modules/admin-mfa/domain/totp-secret';
import { base32ToBuffer } from '../../src/modules/admin-mfa/domain/totp-verify';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

// Phase 10 (PR 10.10) — step-up auth tests.
//
//   1. @RequiresStepUp decorator stamps the right metadata.
//   2. StepUpGuard:
//      - passes through unannotated routes
//      - 403 STEP_UP_REQUIRED when no session
//      - 403 STEP_UP_REQUIRED when stepUpVerifiedAt is null
//      - 403 STEP_UP_REQUIRED when stepUpVerifiedAt is too old
//      - passes when stepUpVerifiedAt is within the window
//   3. AdminMfaService.stepUp:
//      - rejects un-enrolled admins
//      - verifies TOTP and marks the session
//      - verifies backup code and marks the session
//      - advances mfaLastUsedStep on TOTP success but not on backup-code

describe('@RequiresStepUp decorator (PR 10.10)', () => {
  it('stamps the metadata key with the default 5min maxAgeMs', () => {
    class Test {
      @RequiresStepUp()
      handler() {}
    }
    const meta = Reflect.getMetadata(
      REQUIRES_STEP_UP_METADATA_KEY,
      Test.prototype.handler,
    );
    expect(meta).toEqual({ maxAgeMs: 5 * 60 * 1000 });
  });

  it('honours a custom maxAgeMs override', () => {
    class Test {
      @RequiresStepUp({ maxAgeMs: 60_000 })
      handler() {}
    }
    const meta = Reflect.getMetadata(
      REQUIRES_STEP_UP_METADATA_KEY,
      Test.prototype.handler,
    );
    expect(meta).toEqual({ maxAgeMs: 60_000 });
  });
});

describe('StepUpGuard (PR 10.10)', () => {
  function buildGuard(
    sessionRow:
      | { stepUpVerifiedAt: Date | null; revokedAt: Date | null }
      | null,
  ) {
    const prisma: any = {
      adminSession: {
        findUnique: jest.fn().mockResolvedValue(sessionRow),
      },
    };
    return {
      guard: new StepUpGuard(new Reflector(), prisma as any),
      findUnique: prisma.adminSession.findUnique,
    };
  }

  function makeContext(
    sessionId: string | undefined,
    meta: { maxAgeMs?: number } | undefined,
  ) {
    // Stable handler reference — Reflector.getAllAndOverride reads
    // metadata from the function reference, so getHandler() must
    // return the SAME function across calls.
    const handler = () => undefined;
    if (meta) {
      Reflect.defineMetadata(
        REQUIRES_STEP_UP_METADATA_KEY,
        meta,
        handler,
      );
    }
    const klass = class {};
    return {
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({
        getRequest: () => ({ sessionId }),
      }),
    } as any;
  }

  it('passes through when the route has no @RequiresStepUp metadata', async () => {
    const { guard } = buildGuard(null);
    const ctx = makeContext('sess-1', undefined);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('throws STEP_UP_REQUIRED when no session id is on the request', async () => {
    const { guard } = buildGuard(null);
    const ctx = makeContext(undefined, { maxAgeMs: 5 * 60_000 });
    // Apply metadata to the handler returned by makeContext.
await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws STEP_UP_REQUIRED when the session has never stepped up', async () => {
    const { guard } = buildGuard({
      stepUpVerifiedAt: null,
      revokedAt: null,
    });
    const ctx = makeContext('sess-1', { maxAgeMs: 5 * 60_000 });
await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
    });
  });

  it('throws STEP_UP_REQUIRED when stepUpVerifiedAt is older than maxAgeMs', async () => {
    const stale = new Date(Date.now() - 10 * 60_000); // 10 min ago
    const { guard } = buildGuard({
      stepUpVerifiedAt: stale,
      revokedAt: null,
    });
    const ctx = makeContext('sess-1', { maxAgeMs: 5 * 60_000 });
await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes when stepUpVerifiedAt is within maxAgeMs', async () => {
    const recent = new Date(Date.now() - 60_000); // 1 min ago
    const { guard } = buildGuard({
      stepUpVerifiedAt: recent,
      revokedAt: null,
    });
    const ctx = makeContext('sess-1', { maxAgeMs: 5 * 60_000 });
const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('throws when the session is revoked even if step-up was recent', async () => {
    const { guard } = buildGuard({
      stepUpVerifiedAt: new Date(Date.now() - 60_000),
      revokedAt: new Date(Date.now() - 30_000),
    });
    const ctx = makeContext('sess-1', { maxAgeMs: 5 * 60_000 });
await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('respects a tighter custom maxAgeMs', async () => {
    // step-up 3 minutes ago — passes under default 5min, fails under 1min.
    const threeMinAgo = new Date(Date.now() - 3 * 60_000);
    const { guard } = buildGuard({
      stepUpVerifiedAt: threeMinAgo,
      revokedAt: null,
    });
    const ctx = makeContext('sess-1', { maxAgeMs: 60_000 });
await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('AdminMfaService.stepUp (PR 10.10)', () => {
  const KEY = 'a'.repeat(64);
  const cipher = new MfaSecretCipher({
    get: (k: string) =>
      k === 'ADMIN_MFA_ENCRYPTION_KEY' ? KEY : undefined,
  } as any);

  function makeEnv(): any {
    return {
      getString: (_k: string, fallback?: string) => fallback ?? '',
      get: (k: string) =>
        k === 'ADMIN_MFA_ENCRYPTION_KEY' ? KEY : undefined,
    };
  }

  function makeBackupCodesStub(consumeReturns = false) {
    return {
      generateAndHashForAdmin: async () => [],
      consume: async () => consumeReturns,
      remainingCount: async () => 0,
    } as any;
  }

  interface AdminRow {
    id: string;
    email?: string;
    mfaEnabledAt?: Date | null;
    mfaSecretCiphertext?: string | null;
    mfaLastUsedStep?: number | null;
  }

  class FakeRepo {
    public rows = new Map<string, AdminRow>();
    public markedSessions: string[] = [];
    public adminUpdates: Array<{ id: string; data: any }> = [];

    async findAdminById(id: string, _select?: any) {
      return this.rows.get(id) ?? null;
    }
    async updateAdmin(id: string, data: any) {
      this.adminUpdates.push({ id, data });
      const row = this.rows.get(id);
      if (row) Object.assign(row, data);
    }
    async markSessionStepUpVerified(sessionId: string) {
      this.markedSessions.push(sessionId);
    }
    // Phase 26 (2026-05-20) — service now calls advanceMfaLastUsedStepCas
    // on the TOTP path before stamping step-up. Mirror prod semantics:
    // succeed when null or strictly less than `step`, else fail.
    async advanceMfaLastUsedStepCas(id: string, step: number): Promise<boolean> {
      const row = this.rows.get(id);
      if (!row) return false;
      if (row.mfaLastUsedStep != null && row.mfaLastUsedStep >= step) {
        return false;
      }
      row.mfaLastUsedStep = step;
      return true;
    }
  }

  function computeCurrentCode(secret: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHmac } = require('crypto');
    const buf = base32ToBuffer(secret);
    const step = Math.floor(Date.now() / 1000 / 30);
    const stepBuf = Buffer.alloc(8);
    stepBuf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
    stepBuf.writeUInt32BE(step & 0xffffffff, 4);
    const hmac = createHmac('sha1', buf).update(stepBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const truncated =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return String(truncated % 1_000_000).padStart(6, '0');
  }

  function buildService(repo: FakeRepo, backupCodes = makeBackupCodesStub()) {
    // Phase 25 (2026-05-20) — AdminMfaService gained AuditPublicFacade
    // + EventEmitter2 deps for the unified audit + side-channel email
    // hooks. The step-up test matrix doesn't observe either, so stub
    // them to no-ops.
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    const events = { emit: jest.fn() } as any;
    return new AdminMfaService(
      repo as any,
      cipher,
      makeEnv(),
      backupCodes,
      audit,
      events,
    );
  }

  it('rejects an admin not found', async () => {
    const repo = new FakeRepo();
    const svc = buildService(repo);
    await expect(svc.stepUp('nope', 'sess-1', '123456')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('rejects when the admin has no MFA enrolled', async () => {
    const repo = new FakeRepo();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      mfaEnabledAt: null,
      mfaSecretCiphertext: null,
    });
    const svc = buildService(repo);
    await expect(
      svc.stepUp('admin-1', 'sess-1', '123456'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.markedSessions).toEqual([]);
  });

  it('verifies a TOTP code and marks the session', async () => {
    const repo = new FakeRepo();
    const secret = generateTotpSecret();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: cipher.encrypt(secret),
      mfaLastUsedStep: null,
    });
    const svc = buildService(repo);
    const code = computeCurrentCode(secret);
    await svc.stepUp('admin-1', 'sess-1', code);

    expect(repo.markedSessions).toEqual(['sess-1']);
    // Phase 26 (2026-05-20) — anti-replay baseline now advances via
    // advanceMfaLastUsedStepCas (atomic) rather than a follow-up
    // updateAdmin call. Assert the column landed on the row directly.
    expect(repo.rows.get('admin-1')!.mfaLastUsedStep).toBeGreaterThan(0);
  });

  it('rejects a replayed TOTP code (already-used step)', async () => {
    const repo = new FakeRepo();
    const secret = generateTotpSecret();
    const currentStep = Math.floor(Date.now() / 1000 / 30);
    repo.rows.set('admin-1', {
      id: 'admin-1',
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: cipher.encrypt(secret),
      mfaLastUsedStep: currentStep, // already at current step
    });
    const svc = buildService(repo);
    const code = computeCurrentCode(secret);
    await expect(
      svc.stepUp('admin-1', 'sess-1', code),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.markedSessions).toEqual([]);
  });

  it('verifies a backup code and marks the session WITHOUT advancing mfaLastUsedStep', async () => {
    const repo = new FakeRepo();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: cipher.encrypt(generateTotpSecret()),
      mfaLastUsedStep: 100,
    });
    const svc = buildService(repo, makeBackupCodesStub(/* consumeReturns */ true));
    await svc.stepUp('admin-1', 'sess-1', 'abcde-12345');

    expect(repo.markedSessions).toEqual(['sess-1']);
    // No mfaLastUsedStep write on backup-code path.
    const hasStepUpdate = repo.adminUpdates.some(
      (u) => u.data.mfaLastUsedStep !== undefined,
    );
    expect(hasStepUpdate).toBe(false);
  });

  it('rejects an invalid backup code', async () => {
    const repo = new FakeRepo();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: cipher.encrypt(generateTotpSecret()),
    });
    const svc = buildService(repo, makeBackupCodesStub(/* consumeReturns */ false));
    await expect(
      svc.stepUp('admin-1', 'sess-1', 'abcde-12345'),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.markedSessions).toEqual([]);
  });
});
