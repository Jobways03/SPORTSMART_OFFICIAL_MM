import { RedisService } from './redis.service';

/**
 * Phase 1 (PR 1.7) — fenced lock release.
 *
 * Pins the contract of `acquireLockWithToken` + `releaseLockWithToken`:
 *   - Acquire writes a per-call UUID as the value via SET NX EX.
 *   - Release runs a Lua CAS: delete iff GET == token. Returns true
 *     when the lock was still ours, false when not (TTL expired and
 *     a successor acquired, or already released).
 *
 * The plain `acquireLock`/`releaseLock` pair stays untouched for the
 * webhook-claim use case where TTL is two orders of magnitude longer
 * than the request body.
 */

function buildService(opts: {
  setReturn?: string | null;
  evalReturn?: number | string;
  evalThrows?: Error;
}) {
  // Note: `?? 'OK'` would mishandle `null` (which is the SET-NX-failed
  // signal). Use explicit `undefined` check so `null` stays null.
  const set = jest
    .fn()
    .mockResolvedValue(opts.setReturn === undefined ? 'OK' : opts.setReturn);
  const evalScript = jest.fn(async () => {
    if (opts.evalThrows) throw opts.evalThrows;
    return opts.evalReturn ?? 1;
  });
  const del = jest.fn().mockResolvedValue(undefined);
  const client = { set, eval: evalScript, del } as any;

  const env = {
    getString: jest.fn().mockReturnValue('redis://localhost'),
  } as any;

  // Construct without going through the real ctor's `new Redis(...)`
  // — we bypass DI by stubbing `client` on the prototype after
  // instantiation, but the simplest path is to assign directly via
  // any-cast after the fact.
  const service = Object.create(RedisService.prototype) as RedisService;
  (service as any).client = client;
  (service as any).logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  (service as any).envService = env;

  return { service, client, set, evalScript, del };
}

describe('RedisService — fenced lock primitives (PR 1.7)', () => {
  // ── acquireLockWithToken ───────────────────────────────────────────

  it('acquireLockWithToken returns { acquired: true, token } on SET NX OK', async () => {
    const { service, set } = buildService({ setReturn: 'OK' });

    const result = await service.acquireLockWithToken('cron-lock:job1', 60);

    expect(result.acquired).toBe(true);
    expect(typeof result.token).toBe('string');
    expect(result.token!.length).toBeGreaterThan(0);
    // The token must be the value passed to SET — that's what makes
    // fencing work.
    expect(set).toHaveBeenCalledWith(
      'cron-lock:job1',
      result.token,
      'EX',
      60,
      'NX',
    );
  });

  it('acquireLockWithToken returns { acquired: false, token: null } when SET NX fails', async () => {
    const { service } = buildService({ setReturn: null });

    const result = await service.acquireLockWithToken('cron-lock:contested', 60);

    expect(result).toEqual({ acquired: false, token: null });
  });

  it('each acquire mints a unique token', async () => {
    const { service } = buildService({ setReturn: 'OK' });

    const a = await service.acquireLockWithToken('k', 60);
    const b = await service.acquireLockWithToken('k', 60);

    expect(a.token).not.toEqual(b.token);
  });

  // ── releaseLockWithToken ───────────────────────────────────────────

  it('releaseLockWithToken returns true when Lua deleted the key', async () => {
    const { service, evalScript } = buildService({ evalReturn: 1 });

    const released = await service.releaseLockWithToken(
      'cron-lock:job1',
      'tok-1',
    );

    expect(released).toBe(true);
    // The eval call must be the CAS script (1 key, args: key, token).
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1])"),
      1,
      'cron-lock:job1',
      'tok-1',
    );
  });

  it('releaseLockWithToken returns false when CAS does NOT match (TTL expired, successor holds)', async () => {
    const { service } = buildService({ evalReturn: 0 });

    const released = await service.releaseLockWithToken(
      'cron-lock:job1',
      'tok-old',
    );

    // Critical: a stale release CANNOT delete a successor's lock.
    // The Lua script returned 0; the helper surfaces that as `false`.
    expect(released).toBe(false);
  });

  it('releaseLockWithToken returns false on an empty token (defensive)', async () => {
    const { service, evalScript } = buildService({});

    const released = await service.releaseLockWithToken('cron-lock:job1', '');

    expect(released).toBe(false);
    // No Redis round-trip for an empty token.
    expect(evalScript).not.toHaveBeenCalled();
  });

  it('releaseLockWithToken returns false (does NOT throw) on Redis error', async () => {
    const { service } = buildService({ evalThrows: new Error('connection lost') });

    const released = await service.releaseLockWithToken('cron-lock:job1', 'tok');

    expect(released).toBe(false);
  });

  // ── full lifecycle ─────────────────────────────────────────────────

  it('acquire→release happy path round-trips the token correctly', async () => {
    const { service, evalScript } = buildService({
      setReturn: 'OK',
      evalReturn: 1,
    });

    const { acquired, token } = await service.acquireLockWithToken('k', 60);
    expect(acquired).toBe(true);
    expect(token).toBeTruthy();

    const released = await service.releaseLockWithToken('k', token!);
    expect(released).toBe(true);
    expect(evalScript).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'k',
      token,
    );
  });

  // ── the headline race scenario ─────────────────────────────────────

  it('SCENARIO: stale holder cannot delete a successor lock', async () => {
    // Process A acquires with token-A. Its TTL expires while the body
    // is still running. Process B acquires with token-B (new lock).
    // Process A finishes, calls releaseLockWithToken('k', token-A).
    // The Lua CAS sees the current value is token-B (not token-A) and
    // returns 0 — the helper reports `false`. B's lock is preserved.
    const { service } = buildService({ evalReturn: 0 });

    const stillHoldingOriginal = await service.releaseLockWithToken(
      'k',
      'tok-A-stale',
    );

    expect(stillHoldingOriginal).toBe(false);
    // The successor lock is NOT touched.
  });
});
