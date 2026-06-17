import { PostOfficeCacheService } from './post-office-cache.service';

/**
 * Coordinate approximation for real-but-coordless pincodes (2026-06-16).
 *
 * Some valid pincodes exist in the post_offices master but have NULL
 * coordinates (~92 of 165K rows, e.g. 500063). Before this fix the allocator
 * couldn't compute a distance for such a pincode, so the strict retail 50km gate
 * silently dropped the only local seller and a same-city order became
 * unserviceable. The cache now approximates a real-but-coordless pincode from
 * its postal-region neighbours (longest prefix first) while leaving genuinely
 * UNKNOWN pincodes as null (so PINCODE_UNKNOWN still fires).
 */
describe('PostOfficeCacheService — region approximation for coordless pincodes', () => {
  const HYD = { latitude: 17.4063, longitude: 78.5413 };

  function build(opts: {
    exactCoords?: { latitude: number; longitude: number } | null;
    pincodeExists?: boolean;
    regionCentroid?: { latitude: number; longitude: number } | null;
  }) {
    const prisma: any = {
      postOffice: {
        findFirst: jest.fn(async ({ where }: any) => {
          // The coord-bearing exact lookup filters latitude: { not: null }.
          if (where.latitude) {
            return opts.exactCoords
              ? { ...opts.exactCoords, state: 'TG' }
              : null;
          }
          // The existence probe (no latitude filter).
          return opts.pincodeExists ? { state: 'TG' } : null;
        }),
        findMany: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({
          _avg: opts.regionCentroid
            ? { latitude: opts.regionCentroid.latitude, longitude: opts.regionCentroid.longitude }
            : { latitude: null, longitude: null },
        })),
      },
    };
    const redis: any = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
    return { svc: new PostOfficeCacheService(prisma, redis), prisma };
  }

  it('returns exact coords as-is (no approximation) when the pincode has its own', async () => {
    const { svc, prisma } = build({ exactCoords: { latitude: 19.07, longitude: 72.87 } });
    const res = await svc.lookup('400001');
    expect(res).toMatchObject({ latitude: 19.07, longitude: 72.87 });
    expect(res?.approximate).toBeUndefined();
    expect(prisma.postOffice.aggregate).not.toHaveBeenCalled(); // no fallback needed
  });

  it('approximates a real-but-coordless pincode from its region centroid', async () => {
    const { svc, prisma } = build({
      exactCoords: null,
      pincodeExists: true,
      regionCentroid: HYD,
    });
    const res = await svc.lookup('500063');
    expect(res).toMatchObject({ latitude: HYD.latitude, longitude: HYD.longitude, approximate: true });
    expect(prisma.postOffice.aggregate).toHaveBeenCalled();
  });

  it('returns null for a genuinely-unknown pincode (preserves PINCODE_UNKNOWN)', async () => {
    const { svc, prisma } = build({ exactCoords: null, pincodeExists: false });
    const res = await svc.lookup('999999');
    expect(res).toBeNull();
    // No region centroid attempted for a non-existent pincode.
    expect(prisma.postOffice.aggregate).not.toHaveBeenCalled();
  });

  it('rejects malformed pincodes without touching the DB', async () => {
    const { svc, prisma } = build({ exactCoords: null });
    expect(await svc.lookup('abc')).toBeNull();
    expect(prisma.postOffice.findFirst).not.toHaveBeenCalled();
  });

  it('lookupMany also approximates a coordless pincode', async () => {
    const { svc } = build({ exactCoords: null, pincodeExists: true, regionCentroid: HYD });
    const map = await svc.lookupMany(['500063']);
    expect(map.get('500063')).toMatchObject({ approximate: true, latitude: HYD.latitude });
  });
});
