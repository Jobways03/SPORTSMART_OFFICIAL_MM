import { PostOfficeCacheService } from './post-office-cache.service';

/**
 * Coordinate resolution for pincodes — region approximation (2026-06-16) +
 * robust multi-office representative (2026-06-28).
 *
 * A pincode maps to many post offices, and some India-Post source rows carry
 * corrupt geocodes — e.g. 500056's Non-Delivery "Neredmet S.O" sat ~57 km from
 * the real pincode alongside the accurate Delivery "Ramakrishna Puram S.O",
 * which (via the old arbitrary findFirst) made a same-city retail seller fail the
 * 50 km serviceability gate, NON-deterministically. The cache now resolves ONE
 * robust, deterministic representative coordinate (prefer Delivery offices, then
 * a median-anchored, outlier-trimmed centroid), still approximates real-but-
 * coordless pincodes from their region, and still leaves unknown pincodes null.
 */
describe('PostOfficeCacheService — robust coordinate resolution', () => {
  const HYD = { latitude: 17.4063, longitude: 78.5413 };

  type Office = {
    latitude: number;
    longitude: number;
    state?: string | null;
    delivery?: string;
    officeName?: string;
    pincode?: string;
  };

  function build(opts: {
    exactOffices?: Office[]; // coord-bearing offices returned for the exact query
    exactCoords?: { latitude: number; longitude: number } | null; // shorthand: one Delivery office
    pincodeExists?: boolean; // existence probe used by approximateByRegion
    regionCentroid?: { latitude: number; longitude: number } | null;
  }) {
    const exactRows: Office[] =
      opts.exactOffices ??
      (opts.exactCoords
        ? [
            {
              ...opts.exactCoords,
              state: 'TG',
              delivery: 'Delivery',
              officeName: 'Sole S.O',
            },
          ]
        : []);
    const prisma: any = {
      postOffice: {
        // Exact coord-bearing lookup is now findMany — ALL offices for the pincode.
        findMany: jest.fn(async ({ where }: any) =>
          where?.latitude ? exactRows : [],
        ),
        // findFirst is now ONLY the existence probe inside approximateByRegion.
        findFirst: jest.fn(async () =>
          opts.pincodeExists ? { state: 'TG' } : null,
        ),
        aggregate: jest.fn(async () => ({
          _avg: opts.regionCentroid
            ? {
                latitude: opts.regionCentroid.latitude,
                longitude: opts.regionCentroid.longitude,
              }
            : { latitude: null, longitude: null },
        })),
      },
    };
    const redis: any = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
    };
    return { svc: new PostOfficeCacheService(prisma, redis), prisma };
  }

  it('returns the sole office coords as-is (no approximation)', async () => {
    const { svc, prisma } = build({
      exactCoords: { latitude: 19.07, longitude: 72.87 },
    });
    const res = await svc.lookup('400001');
    expect(res).toMatchObject({ latitude: 19.07, longitude: 72.87 });
    expect(res?.approximate).toBeUndefined();
    expect(prisma.postOffice.aggregate).not.toHaveBeenCalled();
  });

  it('picks the Delivery office and ignores a corrupt Non-Delivery coordinate (the 500056 bug)', async () => {
    const { svc, prisma } = build({
      exactOffices: [
        // corrupt geocode ~57 km off — and Non-Delivery
        {
          latitude: 17.76919444,
          longitude: 78.90222222,
          state: 'TG',
          delivery: 'Non Delivery',
          officeName: 'Neredmet S.O',
        },
        // accurate Delivery office (the real seller location)
        {
          latitude: 17.47175434,
          longitude: 78.54022051,
          state: 'TG',
          delivery: 'Delivery',
          officeName: 'Ramakrishna Puram S.O',
        },
      ],
    });
    const res = await svc.lookup('500056');
    expect(res!.latitude).toBeCloseTo(17.4717, 3);
    expect(res!.longitude).toBeCloseTo(78.5402, 3);
    // It had real coords, so no region fallback was needed.
    expect(prisma.postOffice.aggregate).not.toHaveBeenCalled();
  });

  it('trims a corrupt outlier among multiple Delivery offices (median-anchored)', async () => {
    const { svc } = build({
      exactOffices: [
        { latitude: 17.45, longitude: 78.5, delivery: 'Delivery', officeName: 'A S.O' },
        { latitude: 17.46, longitude: 78.51, delivery: 'Delivery', officeName: 'B S.O' },
        // far outlier (~280 km) — must be trimmed before averaging
        { latitude: 19.99, longitude: 80.0, delivery: 'Delivery', officeName: 'C S.O' },
      ],
    });
    const res = await svc.lookup('500099');
    expect(res!.latitude).toBeCloseTo(17.455, 2);
    expect(res!.longitude).toBeCloseTo(78.505, 2);
  });

  it('resolves identically regardless of office row order (deterministic)', async () => {
    const offices: Office[] = [
      { latitude: 17.47, longitude: 78.54, delivery: 'Delivery', officeName: 'Ramakrishna Puram S.O' },
      { latitude: 17.769, longitude: 78.902, delivery: 'Non Delivery', officeName: 'Neredmet S.O' },
    ];
    const a = (await build({ exactOffices: offices }).svc.lookup('500056'))!;
    const b = (await build({ exactOffices: [...offices].reverse() }).svc.lookup('500056'))!;
    expect(a.latitude).toBeCloseTo(b.latitude!, 6);
    expect(a.longitude).toBeCloseTo(b.longitude!, 6);
  });

  it('falls back to all offices when none are flagged Delivery', async () => {
    const { svc } = build({
      exactOffices: [
        { latitude: 17.45, longitude: 78.5, delivery: 'Non Delivery', officeName: 'A S.O' },
        { latitude: 17.46, longitude: 78.51, delivery: 'Non Delivery', officeName: 'B S.O' },
      ],
    });
    const res = await svc.lookup('500098');
    expect(res!.latitude).toBeCloseTo(17.455, 2);
    expect(res!.longitude).toBeCloseTo(78.505, 2);
  });

  it('uses the postal-region centroid to pick the right cluster when Delivery offices are far apart', async () => {
    const { svc, prisma } = build({
      exactOffices: [
        // two Delivery offices ~75 km apart → no majority cluster; the pool median
        // floats between them, so the region anchor must break the tie.
        { latitude: 17.45, longitude: 78.5, delivery: 'Delivery', officeName: 'Good S.O' },
        { latitude: 17.95, longitude: 79.0, delivery: 'Delivery', officeName: 'Zfar S.O' },
      ],
      regionCentroid: { latitude: 17.44, longitude: 78.49 }, // region anchor near 'Good'
    });
    const res = await svc.lookup('500088');
    expect(res!.latitude).toBeCloseTo(17.45, 2);
    expect(res!.longitude).toBeCloseTo(78.5, 2);
    expect(prisma.postOffice.aggregate).toHaveBeenCalled(); // region anchor was consulted
  });

  it('falls back deterministically when far-apart offices have no region coords', async () => {
    const { svc } = build({
      exactOffices: [
        { latitude: 17.45, longitude: 78.5, delivery: 'Delivery', officeName: 'A S.O' },
        { latitude: 17.95, longitude: 79.0, delivery: 'Delivery', officeName: 'B S.O' },
      ],
      regionCentroid: null, // region has no coords → fall back to median-nearest cluster
    });
    const res = await svc.lookup('500077');
    // Never floats into NaN / empty space; resolves to a real cluster.
    expect(Number.isFinite(res!.latitude)).toBe(true);
    expect(Number.isFinite(res!.longitude)).toBe(true);
    expect([17.45, 17.95]).toContain(Number(res!.latitude!.toFixed(2)));
  });

  it('approximates a real-but-coordless pincode from its region centroid', async () => {
    const { svc, prisma } = build({
      exactOffices: [],
      pincodeExists: true,
      regionCentroid: HYD,
    });
    const res = await svc.lookup('500063');
    expect(res).toMatchObject({
      latitude: HYD.latitude,
      longitude: HYD.longitude,
      approximate: true,
    });
    expect(prisma.postOffice.aggregate).toHaveBeenCalled();
  });

  it('returns null for a genuinely-unknown pincode (preserves PINCODE_UNKNOWN)', async () => {
    const { svc, prisma } = build({ exactOffices: [], pincodeExists: false });
    const res = await svc.lookup('999999');
    expect(res).toBeNull();
    expect(prisma.postOffice.aggregate).not.toHaveBeenCalled();
  });

  it('rejects malformed pincodes without touching the DB', async () => {
    const { svc, prisma } = build({ exactOffices: [] });
    expect(await svc.lookup('abc')).toBeNull();
    expect(prisma.postOffice.findMany).not.toHaveBeenCalled();
    expect(prisma.postOffice.findFirst).not.toHaveBeenCalled();
  });

  it('lookupMany also approximates a coordless pincode', async () => {
    const { svc } = build({
      exactOffices: [],
      pincodeExists: true,
      regionCentroid: HYD,
    });
    const map = await svc.lookupMany(['500063']);
    expect(map.get('500063')).toMatchObject({
      approximate: true,
      latitude: HYD.latitude,
    });
  });

  it('lookupMany resolves the robust representative per pincode', async () => {
    const { svc } = build({
      exactOffices: [
        { pincode: '500056', latitude: 17.769, longitude: 78.902, delivery: 'Non Delivery', officeName: 'Neredmet S.O' },
        { pincode: '500056', latitude: 17.47175434, longitude: 78.54022051, delivery: 'Delivery', officeName: 'Ramakrishna Puram S.O' },
      ],
    });
    const map = await svc.lookupMany(['500056']);
    expect(map.get('500056')!.latitude).toBeCloseTo(17.4717, 3);
  });
});
