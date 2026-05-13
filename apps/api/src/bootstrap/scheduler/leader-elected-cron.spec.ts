import { LeaderElectedCron } from './leader-elected-cron';

/**
 * Phase 1 (PR 1.1) — `LeaderElectedCron` is the foundation for closing
 * the multi-replica cron duplication risk (the audit's CRITICAL C1).
 * Every @Cron body migrates to this wrapper in PR 1.2.
 *
 * Contract:
 *   - Lock acquired → body runs → lock released, returns { ran: true }.
 *   - Lock NOT acquired → body skipped, returns { ran: false }.
 *   - Body throws → lock STILL released (finally), then error
 *     propagates so @nestjs/schedule logs it.
 *   - Two concurrent invocations against the same key → exactly one
 *     wins (Redis SET-NX semantics, mocked here as first-wins).
 *   - Release failure does not mask body failure / does not throw.
 */

function buildLeader(opts: {
  acquireImpl?: (key: string, ttl: number) => Promise<boolean>;
  releaseImpl?: (key: string, token: string) => Promise<boolean | void>;
}) {
  // PR 1.7 — leader uses the fenced primitives. Shape the mocks to
  // match: acquireLockWithToken returns `{ acquired, token }`,
  // releaseLockWithToken takes (key, token).
  let tokenCounter = 0;
  const acquireLockWithToken = jest.fn(async (key: string, ttl: number) => {
    const acquired = opts.acquireImpl
      ? await opts.acquireImpl(key, ttl)
      : true;
    if (!acquired) return { acquired: false, token: null };
    return { acquired: true, token: `tok-${++tokenCounter}` };
  });
  const releaseLockWithToken = jest.fn(
    opts.releaseImpl ?? (async () => true),
  );
  const redis = { acquireLockWithToken, releaseLockWithToken } as any;
  const leader = new LeaderElectedCron(redis);
  return { leader, acquireLock: acquireLockWithToken, releaseLock: releaseLockWithToken };
}

describe('LeaderElectedCron', () => {
  // ── Single-replica happy path ──────────────────────────────────────

  it('runs the body and releases the lock when acquired', async () => {
    const body = jest.fn().mockResolvedValue(undefined);
    const { leader, acquireLock, releaseLock } = buildLeader({});

    const result = await leader.run('daily-recon', 3600, body);

    expect(acquireLock).toHaveBeenCalledWith('cron-lock:daily-recon', 3600);
    expect(body).toHaveBeenCalledTimes(1);
    // PR 1.7 — release now takes (key, token).
    expect(releaseLock).toHaveBeenCalledWith(
      'cron-lock:daily-recon',
      expect.any(String),
    );
    expect(result).toEqual({ ran: true });
  });

  // ── Headline contract: multi-replica safety ────────────────────────

  it('SKIPS the body when another replica holds the lock (the headline)', async () => {
    const body = jest.fn();
    const { leader, releaseLock } = buildLeader({
      acquireImpl: async () => false, // SET NX returned null
    });

    const result = await leader.run('daily-recon', 3600, body);

    expect(body).not.toHaveBeenCalled();
    // Don't release a lock we don't hold.
    expect(releaseLock).not.toHaveBeenCalled();
    expect(result).toEqual({ ran: false });
  });

  it('exactly one of N concurrent invocations runs the body', async () => {
    // Simulate Redis SET-NX: first caller wins, rest get false.
    let granted = 0;
    const body = jest.fn();
    const { leader } = buildLeader({
      acquireImpl: async () => {
        granted++;
        return granted === 1;
      },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        leader.run('shared-key', 60, body),
      ),
    );

    const ran = results.filter((r) => r.ran);
    expect(ran).toHaveLength(1);
    expect(body).toHaveBeenCalledTimes(1);
  });

  // ── Error handling ─────────────────────────────────────────────────

  it('releases the lock even when the body throws, and re-propagates the error', async () => {
    const body = jest.fn().mockRejectedValue(new Error('body boom'));
    const { leader, releaseLock } = buildLeader({});

    await expect(leader.run('flaky', 60, body)).rejects.toThrow('body boom');

    // Critical: lock MUST be released so the next tick can re-run.
    // PR 1.7 — fenced release takes (key, token).
    expect(releaseLock).toHaveBeenCalledWith(
      'cron-lock:flaky',
      expect.any(String),
    );
  });

  it('does NOT mask the body error when the release also fails', async () => {
    const body = jest.fn().mockRejectedValue(new Error('body boom'));
    const { leader, releaseLock } = buildLeader({
      releaseImpl: async () => {
        throw new Error('redis down');
      },
    });

    // The original body error wins; release failure is logged.
    await expect(leader.run('double-trouble', 60, body)).rejects.toThrow('body boom');
    expect(releaseLock).toHaveBeenCalled();
  });

  it('returns { ran: true } and releases the lock even when release throws', async () => {
    const body = jest.fn().mockResolvedValue(undefined);
    const { leader, releaseLock } = buildLeader({
      releaseImpl: async () => {
        throw new Error('redis blip');
      },
    });

    // Release failure on the happy path is non-fatal — the body
    // completed successfully and the lock will expire on its own.
    const result = await leader.run('release-blip', 60, body);
    expect(result).toEqual({ ran: true });
    expect(releaseLock).toHaveBeenCalled();
  });

  // ── Argument validation ───────────────────────────────────────────

  it('rejects an empty jobName', async () => {
    const { leader } = buildLeader({});
    await expect(leader.run('', 60, async () => undefined)).rejects.toThrow(
      /jobName must be non-empty/,
    );
  });

  it('rejects a jobName containing spaces (would yield a malformed Redis key)', async () => {
    const { leader } = buildLeader({});
    await expect(
      leader.run('bad name', 60, async () => undefined),
    ).rejects.toThrow(/no-spaces/);
  });

  it('rejects a non-positive ttlSeconds', async () => {
    const { leader } = buildLeader({});
    await expect(leader.run('zero-ttl', 0, async () => undefined)).rejects.toThrow(
      /ttlSeconds must be > 0/,
    );
    await expect(leader.run('neg-ttl', -5, async () => undefined)).rejects.toThrow(
      /ttlSeconds must be > 0/,
    );
  });

  // ── Key namespacing ────────────────────────────────────────────────

  it('namespaces the Redis key as `cron-lock:${jobName}`', async () => {
    const { leader, acquireLock } = buildLeader({});
    await leader.run('my-job', 60, async () => undefined);
    expect(acquireLock).toHaveBeenCalledWith('cron-lock:my-job', 60);
  });
});
