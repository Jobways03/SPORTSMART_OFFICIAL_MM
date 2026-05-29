import 'reflect-metadata';
import { LogoutUserUseCase } from '../../src/modules/identity/application/use-cases/logout-user.use-case';

/**
 * Phase 17 (2026-05-20) — LogoutUserUseCase: default = single
 * session, opt-in = all sessions.
 *
 * Before this PR, every logout call ran `revokeAllUserSessions`,
 * which signed the user out on every device. That's friendly for
 * "I lost my phone" but hostile to the normal "sign out on this
 * laptop, stay signed in on my phone" UX. The new behaviour pins
 * the default to the single-session path and moves the all-sessions
 * path behind `all: true`.
 */

describe('LogoutUserUseCase', () => {
  const makeSvc = () => {
    const sessionRepo: any = {
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
    };
    return {
      svc: new LogoutUserUseCase(sessionRepo, logger),
      sessionRepo,
    };
  };

  it('default revokes only the calling session', async () => {
    const { svc, sessionRepo } = makeSvc();
    const result = await svc.execute({ userId: 'u-1', sessionId: 'sess-1' });
    expect(result.revokedAll).toBe(false);
    expect(sessionRepo.revoke).toHaveBeenCalledWith('sess-1');
    expect(sessionRepo.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it('all=true revokes every user session', async () => {
    const { svc, sessionRepo } = makeSvc();
    const result = await svc.execute({
      userId: 'u-1',
      sessionId: 'sess-1',
      all: true,
    });
    expect(result.revokedAll).toBe(true);
    expect(sessionRepo.revokeAllUserSessions).toHaveBeenCalledWith('u-1');
    expect(sessionRepo.revoke).not.toHaveBeenCalled();
  });
});
