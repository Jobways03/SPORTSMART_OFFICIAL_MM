import 'reflect-metadata';
import { IThinkTrackingPollerCron } from './ithink-tracking-poller.cron';

/**
 * Phase 1 (PR 1.11) — iThink poller persistence.
 *
 * The pre-PR cron held `lastPolledAt` in a private field on the
 * singleton. Two failure modes:
 *
 *   (a) A leader-replica restart resets the field to `null`. The very
 *       next tick polls a fresh 27-min window — fine if the cursor
 *       advanced beyond the iThink 30-min limit while the process was
 *       down, but a downtime of, say, 45 minutes drops 15 minutes of
 *       status events on the floor (events in [down_t + 30m, now − 30m]
 *       fall outside both the old cursor's recovery window AND the new
 *       hard-coded window).
 *
 *   (b) Leader bounce. Replica A polls at T₀, replica B takes the lock
 *       at T₀+10m. B's `lastPolledAt` is null, so B polls a fresh
 *       window — re-fetching every AWB A already ingested. The
 *       IngestTrackingUpdateUseCase is upsert-by-AWB so the data
 *       converges, but the iThink API calls (and rate limits) are
 *       burned twice.
 *
 * PR 1.11 moves the cursor to a `IntegrationPollerCheckpoint` row keyed
 * by poller name. Both failure modes go away:
 *
 *   - On restart, the cursor survives in Postgres and the window
 *     resumes from `lastPolledAt − 2m` overlap (capped at iThink's
 *     30-min hard limit so we never ask for a window the API refuses).
 *
 *   - On leader bounce, the new leader reads the cursor from the same
 *     table the old leader wrote. The throttle check (`elapsed <
 *     intervalMinutes ? skip : poll`) now consults DB state, so a
 *     newly-promoted leader correctly skips a tick the old leader
 *     already covered.
 */

type CheckpointRepoMock = {
  get: jest.Mock;
  set: jest.Mock;
};

type TrackingServiceMock = {
  getAirwaybillsChanged: jest.Mock;
};

type IngestMock = {
  ingestForIThink: jest.Mock;
};

type LeaderMock = {
  run: jest.Mock;
};

function buildConfig(opts: { intervalMinutes?: number; enabled?: boolean; configured?: boolean } = {}) {
  return {
    trackingPollEnabled: opts.enabled ?? true,
    isConfigured: opts.configured ?? true,
    trackingPollIntervalMinutes: opts.intervalMinutes ?? 25,
  } as any;
}

type InstrMock = {
  wrap: jest.Mock;
};

function buildCron(opts: {
  config?: ReturnType<typeof buildConfig>;
  tracking?: TrackingServiceMock;
  ingest?: IngestMock;
  leader?: LeaderMock;
  checkpoints?: CheckpointRepoMock;
  instr?: InstrMock;
} = {}) {
  const tracking: TrackingServiceMock = opts.tracking ?? {
    getAirwaybillsChanged: jest.fn().mockResolvedValue([]),
  };
  const ingest: IngestMock = opts.ingest ?? {
    ingestForIThink: jest.fn().mockResolvedValue({ updated: 0, missing: 0 }),
  };
  const leader: LeaderMock = opts.leader ?? {
    // Default: leader pass-through — actually invokes the body.
    run: jest.fn(async (_name: string, _ttl: number, body: () => Promise<void>) => {
      await body();
      return { ran: true };
    }),
  };
  const checkpoints: CheckpointRepoMock = opts.checkpoints ?? {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  // Phase 5 (PR 5.1) — default pass-through: invoke fn() and return
  // its result so existing assertions on call counts / data still
  // hold. The pr-5.1 describe block below mocks this explicitly to
  // verify the contract.
  const instr: InstrMock = opts.instr ?? {
    wrap: jest.fn(async (_jobName: string, fn: () => Promise<unknown>) => fn()),
  };

  const cron = new IThinkTrackingPollerCron(
    opts.config ?? buildConfig(),
    tracking as any,
    ingest as any,
    leader as any,
    checkpoints as any,
    instr as any,
  );

  return { cron, tracking, ingest, leader, checkpoints, instr };
}

describe('IThinkTrackingPollerCron — checkpoint persistence (PR 1.11)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fresh start (no checkpoint) — polls the configured interval + 2-min overlap window', async () => {
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));

    const { cron, tracking, checkpoints } = buildCron({
      checkpoints: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).toHaveBeenCalledTimes(1);
    const call = tracking.getAirwaybillsChanged.mock.calls[0][0];
    // intervalMinutes=25, overlap=2 → window starts 27 min before now
    expect(call.startDateTime.getTime()).toBe(
      new Date('2026-05-12T09:33:00Z').getTime(),
    );
    expect(call.endDateTime.getTime()).toBe(
      new Date('2026-05-12T10:00:00Z').getTime(),
    );
    // Persisted the new cursor after success
    expect(checkpoints.set).toHaveBeenCalledWith(
      'ithink-tracking',
      new Date('2026-05-12T10:00:00Z'),
    );
  });

  it('recent checkpoint inside interval — skips this tick (throttle)', async () => {
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));

    const recentCheckpoint = new Date('2026-05-12T09:50:00Z'); // 10 min ago
    const { cron, tracking, checkpoints } = buildCron({
      checkpoints: {
        get: jest.fn().mockResolvedValue(recentCheckpoint),
        set: jest.fn(),
      },
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).not.toHaveBeenCalled();
    expect(checkpoints.set).not.toHaveBeenCalled();
  });

  it('checkpoint older than interval but within iThink window — polls from checkpoint − 2min overlap', async () => {
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));

    // Checkpoint at 26 min ago — exceeds the 25-min throttle, still within 30-min iThink limit
    const checkpointAt = new Date('2026-05-12T09:34:00Z');
    const { cron, tracking, checkpoints } = buildCron({
      checkpoints: {
        get: jest.fn().mockResolvedValue(checkpointAt),
        set: jest.fn(),
      },
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).toHaveBeenCalledTimes(1);
    const call = tracking.getAirwaybillsChanged.mock.calls[0][0];
    // Expected window start = checkpointAt − 2 min = 09:32:00
    expect(call.startDateTime.getTime()).toBe(
      new Date('2026-05-12T09:32:00Z').getTime(),
    );
    expect(checkpoints.set).toHaveBeenCalledWith(
      'ithink-tracking',
      new Date('2026-05-12T10:00:00Z'),
    );
  });

  it('checkpoint older than iThink 30-min hard cap — clamps window-start to now − 29 min', async () => {
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));

    // Simulate 2-hour outage: checkpoint at 09:00 (2h ago) but iThink's
    // window is capped at 30 min, so we must clamp.
    const checkpointAt = new Date('2026-05-12T08:00:00Z');
    const { cron, tracking } = buildCron({
      checkpoints: {
        get: jest.fn().mockResolvedValue(checkpointAt),
        set: jest.fn(),
      },
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).toHaveBeenCalledTimes(1);
    const call = tracking.getAirwaybillsChanged.mock.calls[0][0];
    // Window-start clamped at now − 29 min (1 min slack below iThink's 30)
    expect(call.startDateTime.getTime()).toBe(
      new Date('2026-05-12T09:31:00Z').getTime(),
    );
  });

  it('on iThink API failure — does NOT advance the checkpoint (next tick retries the same window)', async () => {
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));

    const { cron, checkpoints } = buildCron({
      tracking: {
        getAirwaybillsChanged: jest.fn().mockRejectedValue(new Error('iThink 503')),
      },
      checkpoints: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn(),
      },
    });

    await cron.tick();

    expect(checkpoints.set).not.toHaveBeenCalled();
  });

  it('does NOT call the API or repo when the integration is disabled', async () => {
    const { cron, tracking, checkpoints } = buildCron({
      config: buildConfig({ enabled: false }),
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).not.toHaveBeenCalled();
    expect(checkpoints.get).not.toHaveBeenCalled();
    expect(checkpoints.set).not.toHaveBeenCalled();
  });

  it('does NOT call the API when credentials are unconfigured', async () => {
    const { cron, tracking, checkpoints } = buildCron({
      config: buildConfig({ configured: false }),
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).not.toHaveBeenCalled();
    expect(checkpoints.set).not.toHaveBeenCalled();
  });

  it('wraps the poll body in LeaderElectedCron.run with a unique job name and ttl', async () => {
    const { cron, leader } = buildCron();
    await cron.tick();

    expect(leader.run).toHaveBeenCalledTimes(1);
    const [jobName, ttlSeconds] = leader.run.mock.calls[0];
    expect(jobName).toBe('ithink-tracking-poller');
    // 20-min TTL — twice the cron tick interval so a slow run finishes
    // before the next tick contests the lock.
    expect(ttlSeconds).toBe(20 * 60);
  });

  it('skips silently when the leader-lock is held by another replica', async () => {
    const { cron, tracking, checkpoints } = buildCron({
      leader: {
        // Lock not acquired — body not invoked. Mirrors what
        // LeaderElectedCron.run does on a miss.
        run: jest.fn().mockResolvedValue({ ran: false }),
      },
    });

    await cron.tick();

    expect(tracking.getAirwaybillsChanged).not.toHaveBeenCalled();
    expect(checkpoints.get).not.toHaveBeenCalled();
    expect(checkpoints.set).not.toHaveBeenCalled();
  });
});

describe('IThinkTrackingPollerCron — cron-run observability (PR 5.1)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-12T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('wraps the poll body in instr.wrap with the canonical job name', async () => {
    const { cron, instr } = buildCron();
    await cron.tick();

    expect(instr.wrap).toHaveBeenCalledTimes(1);
    const [jobName, fn] = instr.wrap.mock.calls[0];
    expect(jobName).toBe('ithink-tracking-poller');
    expect(typeof fn).toBe('function');
  });

  it('returns structured metrics from pollOnce so cron_runs.result captures the per-tick numbers', async () => {
    let capturedResult: unknown;
    const instr: InstrMock = {
      wrap: jest.fn(async (_name: string, fn: () => Promise<unknown>) => {
        capturedResult = await fn();
        return capturedResult;
      }),
    };
    const { cron } = buildCron({
      tracking: {
        getAirwaybillsChanged: jest.fn().mockResolvedValue(['AWB1', 'AWB2', 'AWB3']),
      },
      ingest: {
        ingestForIThink: jest.fn().mockResolvedValue({ updated: 2, missing: 1 }),
      },
      instr,
    });

    await cron.tick();
    expect(capturedResult).toEqual({
      skipped: false,
      awbs: 3,
      updated: 2,
      orphan: 1,
    });
  });

  it('returns skipped=true when the throttle short-circuits', async () => {
    let capturedResult: unknown;
    const instr: InstrMock = {
      wrap: jest.fn(async (_name: string, fn: () => Promise<unknown>) => {
        capturedResult = await fn();
        return capturedResult;
      }),
    };
    // Last polled 10 min ago — throttle still active (interval 25)
    const { cron } = buildCron({
      checkpoints: {
        get: jest.fn().mockResolvedValue(new Date('2026-05-12T09:50:00Z')),
        set: jest.fn(),
      },
      instr,
    });

    await cron.tick();
    expect(capturedResult).toEqual({
      skipped: true,
      awbs: 0,
      updated: 0,
      orphan: 0,
    });
  });

  it('on iThink API failure the instr.wrap throw is swallowed at the tick boundary (no @nestjs/schedule noise)', async () => {
    // The wrap REJECTS so cron_runs records FAILED. The outer
    // try/catch in tick() prevents the rejection from propagating
    // to the scheduler — the cron tick "completes" from @nestjs/
    // schedule's POV. Heartbeat detector lives in cron_runs and
    // sees the FAILED status there.
    const instr: InstrMock = {
      wrap: jest.fn(async (_name: string, fn: () => Promise<unknown>) => {
        try {
          return await fn();
        } catch (err) {
          // simulate the actual instr.wrap behavior — re-throw after
          // recording status=FAILED.
          throw err;
        }
      }),
    };
    const { cron, checkpoints } = buildCron({
      tracking: {
        getAirwaybillsChanged: jest.fn().mockRejectedValue(new Error('iThink 503')),
      },
      instr,
    });

    // Should NOT throw — the cron tick is swallow-safe.
    await expect(cron.tick()).resolves.toBeUndefined();
    // Checkpoint stays untouched on failure.
    expect(checkpoints.set).not.toHaveBeenCalled();
  });
});
