// Phase 134 — runtime, soak-aware permission check for body-dependent
// authorization. Mirrors the PermissionsGuard's strict/soak contract: throws
// in strict mode, logs+allows in soak.

import { requirePermissionOrSoak } from './require-permission';
import { ForbiddenAppException } from '../exceptions';

const env = (strict: boolean) =>
  ({ getBoolean: jest.fn().mockReturnValue(strict) }) as any;
const reqWith = (permissions: string[]) => ({
  adminId: 'a-1',
  user: { permissions },
});

const call = (req: any, strict: boolean) =>
  requirePermissionOrSoak({
    req,
    permission: 'disputes.internalNote',
    env: env(strict),
    context: 'dispute.internalNote',
  });

describe('requirePermissionOrSoak', () => {
  it('passes silently when the actor holds the permission (strict)', () => {
    expect(() => call(reqWith(['disputes.internalNote']), true)).not.toThrow();
  });

  it('throws ForbiddenAppException in strict mode when the permission is missing', () => {
    expect(() => call(reqWith(['disputes.reply']), true)).toThrow(
      ForbiddenAppException,
    );
  });

  it('allows through (no throw) in soak mode when the permission is missing', () => {
    expect(() => call(reqWith(['disputes.reply']), false)).not.toThrow();
  });

  it('treats an absent permissions array as missing (strict → throws)', () => {
    expect(() => call({ adminId: 'a-1' }, true)).toThrow(ForbiddenAppException);
  });
});
