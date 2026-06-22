import 'reflect-metadata';
import {
  TransportSpeedService,
  haversineKm,
  istHour,
} from './transport-speed.service';

// Two pincode centroids ~11 km apart, and one ~56 km away (mirrors the
// reassignment scenario: a near seller vs a far seller).
const HYD_A = { latitude: 17.385, longitude: 78.4867 }; // ~Hyderabad
const HYD_NEAR = { latitude: 17.45, longitude: 78.55 }; // ~10 km from A
const FAR = { latitude: 17.75, longitude: 78.9 }; // ~56 km from A

/** A UTC instant whose India-Standard-Time hour is exactly `h` (IST = UTC+5:30). */
function atIstHour(h: number): Date {
  return new Date(Date.UTC(2026, 5, 20, h, 0, 0) - 5.5 * 60 * 60 * 1000);
}

function build(opts: {
  enabled?: boolean;
  maxKm?: number;
  cutoffHour?: number;
  /** IST hour to pin "now" at; defaults to 9 AM — before the 2 PM cutoff. */
  nowIstHour?: number;
  /** NDD_TAT_CHECK_ENABLED — defaults to true (matches the env default). */
  tatCheckEnabled?: boolean;
  /** expected_tat(N) TAT in days. Default 1 (= next-day serviceable). */
  tatDays?: number | null;
  /** Make expected_tat throw, to exercise the fail-closed path. */
  tatThrows?: boolean;
  coords?: Record<
    string,
    { latitude: number; longitude: number; approximate?: boolean } | null
  >;
}) {
  const coords = opts.coords ?? {};
  // Stand-in for PostOfficeCacheService: returns the same coord shape its
  // `lookup` does (or null for an unknown pincode).
  const postOffice: any = {
    lookup: jest.fn(async (pincode: string) => coords[pincode] ?? null),
  };
  const env: any = {
    getBoolean: (k: string, d: boolean) =>
      k === 'NDD_ENABLED'
        ? opts.enabled ?? d
        : k === 'NDD_TAT_CHECK_ENABLED'
          ? opts.tatCheckEnabled ?? d
          : d,
    getNumber: (k: string, d: number) =>
      k === 'NDD_CUTOFF_HOUR'
        ? opts.cutoffHour ?? d
        : k === 'NDD_MAX_DISTANCE_KM'
          ? opts.maxKm ?? d
          : d,
  };
  // Stand-in for DelhiveryToolsService.expectedTat — returns a TAT (or throws).
  const delhiveryTools: any = {
    expectedTat: jest.fn(async () => {
      if (opts.tatThrows) throw new Error('delhivery unavailable');
      const tatDays = opts.tatDays === undefined ? 1 : opts.tatDays;
      return { tatDays: tatDays ?? undefined, raw: { tat: tatDays ?? undefined } };
    }),
  };
  // Minimal in-memory RedisService stand-in (JSON round-trip like the real one).
  const store = new Map<string, unknown>();
  const redis: any = {
    get: jest.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
  };
  const svc = new TransportSpeedService(postOffice, env, delhiveryTools, redis);
  // Pin "now" so the cutoff gate is deterministic regardless of wall-clock time.
  jest.spyOn(svc as any, 'now').mockReturnValue(atIstHour(opts.nowIstHour ?? 9));
  return { svc, postOffice, delhiveryTools, redis };
}

describe('haversineKm', () => {
  it('is ~0 for the same point and grows with separation', () => {
    expect(haversineKm(17.385, 78.4867, 17.385, 78.4867)).toBeCloseTo(0, 5);
    const near = haversineKm(HYD_A.latitude, HYD_A.longitude, HYD_NEAR.latitude, HYD_NEAR.longitude);
    const far = haversineKm(HYD_A.latitude, HYD_A.longitude, FAR.latitude, FAR.longitude);
    expect(near).toBeLessThan(50);
    expect(far).toBeGreaterThan(50);
  });
});

describe('istHour', () => {
  it('converts a UTC instant to its IST hour (+5:30, no DST)', () => {
    expect(istHour(new Date('2026-06-20T03:30:00Z'))).toBe(9); // 09:00 IST
    expect(istHour(new Date('2026-06-20T08:30:00Z'))).toBe(14); // 14:00 IST
    expect(istHour(new Date('2026-06-20T18:30:00Z'))).toBe(0); // 00:00 IST next day
  });
});

describe('TransportSpeedService.resolve', () => {
  it("defaults to 'D' when the NDD feature flag is off", async () => {
    const { svc, postOffice } = build({ enabled: false, coords: { '500001': HYD_A, '500002': HYD_NEAR } });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
    // Short-circuits before any coordinate lookup.
    expect(postOffice.lookup).not.toHaveBeenCalled();
  });

  it("returns 'F' for a near route (≤ 50 km) when enabled", async () => {
    const { svc } = build({ enabled: true, coords: { '500001': HYD_A, '500002': HYD_NEAR } });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('F');
  });

  it("returns 'D' for a far route (> 50 km) — the 56 km reassignment case", async () => {
    const { svc } = build({ enabled: true, coords: { '500001': HYD_A, '509999': FAR } });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '509999', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it("forces 'D' for reverse / RTO shipments regardless of distance", async () => {
    const { svc, postOffice } = build({ enabled: true, coords: { '500001': HYD_A, '500002': HYD_NEAR } });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'reverse' }),
    ).resolves.toBe('D');
    expect(postOffice.lookup).not.toHaveBeenCalled();
  });

  it("fails safe to 'D' when a pincode is unknown to the cache", async () => {
    const { svc } = build({ enabled: true, coords: { '500001': HYD_A, '500002': null } });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it("still books 'F' on approximate coords for a coordless-but-near pincode", async () => {
    // 500002 has no exact coords, but the cache rescues it with a postal-region
    // approximation — a near route must NOT silently fall back to 'D'.
    const { svc } = build({
      enabled: true,
      coords: {
        '500001': HYD_A,
        '500002': { ...HYD_NEAR, approximate: true },
      },
    });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('F');
  });

  it("fails safe to 'D' for a missing / malformed pincode", async () => {
    const { svc } = build({ enabled: true, coords: {} });
    await expect(svc.resolve({ pickupPincode: '', dropPincode: '500002' })).resolves.toBe('D');
    await expect(svc.resolve({ pickupPincode: 'abc', dropPincode: '500002' })).resolves.toBe('D');
    await expect(svc.resolve({ pickupPincode: '500001', dropPincode: null })).resolves.toBe('D');
  });

  it('honours a configurable distance threshold', async () => {
    // Same near route, but a 5 km cap → now beyond it → 'D'.
    const { svc } = build({ enabled: true, maxKm: 5, coords: { '500001': HYD_A, '500002': HYD_NEAR } });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it("still books 'F' for a near route booked before the 2 PM IST cutoff", async () => {
    const { svc } = build({
      enabled: true,
      nowIstHour: 11, // 11 AM IST
      coords: { '500001': HYD_A, '500002': HYD_NEAR },
    });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('F');
  });

  it("downgrades a near route to 'D' when booked after the 2 PM IST cutoff", async () => {
    const { svc } = build({
      enabled: true,
      nowIstHour: 19, // 7 PM IST — too late for tonight's line-haul
      coords: { '500001': HYD_A, '500002': HYD_NEAR },
    });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it("treats the cutoff hour as inclusive (exactly 14:00 IST → 'D')", async () => {
    const { svc } = build({
      enabled: true,
      nowIstHour: 14,
      coords: { '500001': HYD_A, '500002': HYD_NEAR },
    });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it('honours a configurable cutoff hour', async () => {
    // Cutoff pushed out to 20:00 → an 18:00 booking is still NDD-eligible.
    const { svc } = build({
      enabled: true,
      cutoffHour: 20,
      nowIstHour: 18,
      coords: { '500001': HYD_A, '500002': HYD_NEAR },
    });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('F');
  });
});

describe('TransportSpeedService.resolve — NDD serviceability (expected_tat)', () => {
  const NEAR = { '500001': HYD_A, '500002': HYD_NEAR };

  it("books 'F' when Delhivery confirms next-day (tat ≤ 1) on the lane", async () => {
    const { svc, delhiveryTools } = build({ enabled: true, tatDays: 1, coords: NEAR });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('F');
    expect(delhiveryTools.expectedTat).toHaveBeenCalledWith(
      expect.objectContaining({ origin: '500001', destination: '500002', mot: 'N' }),
    );
  });

  it("downgrades to 'D' when Delhivery has no next-day TAT for the lane", async () => {
    const { svc } = build({ enabled: true, tatDays: null, coords: NEAR });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it("downgrades to 'D' when the lane's TAT is beyond next-day (tat > 1)", async () => {
    const { svc } = build({ enabled: true, tatDays: 2, coords: NEAR });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it("fails closed to 'D' when the expected_tat call errors", async () => {
    const { svc } = build({ enabled: true, tatThrows: true, coords: NEAR });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('D');
  });

  it('skips the serviceability check when NDD_TAT_CHECK_ENABLED is off', async () => {
    // Kill-switch: distance + cutoff alone decide; no Delhivery call is made.
    const { svc, delhiveryTools } = build({
      enabled: true,
      tatCheckEnabled: false,
      tatDays: null, // would say "not serviceable" — but the check is skipped
      coords: NEAR,
    });
    await expect(
      svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' }),
    ).resolves.toBe('F');
    expect(delhiveryTools.expectedTat).not.toHaveBeenCalled();
  });

  it('caches the lane verdict — a repeat booking does not re-call Delhivery', async () => {
    const { svc, delhiveryTools } = build({ enabled: true, tatDays: 1, coords: NEAR });
    await svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' });
    await svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' });
    expect(delhiveryTools.expectedTat).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a transient error verdict (next booking retries)', async () => {
    const { svc, delhiveryTools } = build({ enabled: true, tatThrows: true, coords: NEAR });
    await svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' });
    await svc.resolve({ pickupPincode: '500001', dropPincode: '500002', direction: 'forward' });
    expect(delhiveryTools.expectedTat).toHaveBeenCalledTimes(2);
  });
});
