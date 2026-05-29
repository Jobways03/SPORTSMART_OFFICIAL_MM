import 'reflect-metadata';
import { EmailBruteForceService } from '../../src/modules/identity/application/services/email-brute-force.service';

/**
 * Phase 17 (2026-05-20) — Per-email brute-force counter.
 *
 * Covers the soft-lock state machine:
 *   • assertNotLocked passes when the lock key is absent (ttl = -2);
 *   • assertNotLocked throws when the lock key is present (ttl > 0);
 *   • recordFailure increments the counter and sets EXPIRE on first
 *     bump (count === 1 path);
 *   • crossing the threshold writes the soft-lock key;
 *   • clear() deletes both counter and lock;
 *   • Redis failures degrade open (assertNotLocked does NOT throw).
 */

describe('EmailBruteForceService', () => {
  const makeSvc = (clientOverrides: Partial<any> = {}) => {
    const client = {
      ttl: jest.fn().mockResolvedValue(-2),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      ...clientOverrides,
    };
    const redis: any = { getClient: () => client };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    return { svc: new EmailBruteForceService(redis, logger), client };
  };

  it('assertNotLocked passes when no lock key exists', async () => {
    const { svc } = makeSvc();
    await expect(svc.assertNotLocked('a@b.com')).resolves.toBeUndefined();
  });

  it('assertNotLocked throws when the lock key has ttl > 0', async () => {
    const { svc } = makeSvc({ ttl: jest.fn().mockResolvedValue(600) });
    await expect(svc.assertNotLocked('a@b.com')).rejects.toThrow(/Try again/);
  });

  it('recordFailure: first call sets counter + expire', async () => {
    const { svc, client } = makeSvc({ incr: jest.fn().mockResolvedValue(1) });
    await svc.recordFailure('a@b.com');
    expect(client.expire).toHaveBeenCalledTimes(1);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('recordFailure: crossing threshold writes the soft-lock', async () => {
    const { svc, client } = makeSvc({ incr: jest.fn().mockResolvedValue(10) });
    await svc.recordFailure('a@b.com');
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set.mock.calls[0][0]).toContain('auth:login:email-locked:');
  });

  it('clear deletes both counter and lock keys', async () => {
    const { svc, client } = makeSvc();
    await svc.clear('a@b.com');
    expect(client.del).toHaveBeenCalledTimes(2);
  });

  it('degrades open when Redis throws (assertNotLocked does not throw)', async () => {
    const { svc } = makeSvc({
      ttl: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    await expect(svc.assertNotLocked('a@b.com')).resolves.toBeUndefined();
  });
});
