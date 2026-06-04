// Cluster E (#217) — media storage orphan sweep behavioural tests.
//
// Pins the genuine fixes:
//   #4  shared-asset guard — never destroy a media storage asset still
//       referenced by a LIVE (non-soft-deleted) image row.
//   #19 CAS delete — only delete the DB row while the parent is still
//       soft-deleted (a restore under us must win).
//   #5  retry escalation — a persistently-failing row flips deleteFailed
//       past the cap instead of churning forever.
//
// Drives the private sweepOnce() directly (mirrors sla-breach-sweep.spec),
// so the leader/instrumentation wrappers are out of scope here.

import { MediaOrphanSweepCron } from './media-orphan-sweep.cron';

function build() {
  const productImage = {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue({ deleteAttemptCount: 1 }),
  };
  const productVariantImage = {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue({ deleteAttemptCount: 1 }),
  };
  const prisma: any = { productImage, productVariantImage };
  const env: any = {
    getString: jest.fn((_k: string, d: string) => d),
    getNumber: jest.fn((_k: string, d: number) => d),
  };
  const media: any = { delete: jest.fn().mockResolvedValue(undefined) };
  const leader: any = { run: jest.fn() };
  const instr: any = { wrap: jest.fn() };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const cron = new MediaOrphanSweepCron(
    prisma,
    env,
    media,
    leader,
    instr,
    audit,
  );
  return { cron, prisma, productImage, productVariantImage, media };
}

const sweepOnce = (cron: MediaOrphanSweepCron) =>
  (cron as unknown as { sweepOnce: () => Promise<any> }).sweepOnce();

describe('MediaOrphanSweepCron.sweepOnce', () => {
  it('deletes the media storage asset + DB row for a non-shared orphan', async () => {
    const { cron, productImage, media } = build();
    productImage.findMany.mockResolvedValueOnce([{ id: 'img-1', publicId: 'pid-1' }]);
    // count=0 on both tables → not shared.

    const out = await sweepOnce(cron);

    expect(media.delete).toHaveBeenCalledWith('pid-1');
    expect(productImage.deleteMany).toHaveBeenCalledWith({
      where: { id: 'img-1', product: { isDeleted: true } },
    });
    expect(out.deleted).toBe(1);
    expect(out.skippedShared).toBe(0);
  });

  it('SHARED asset: skips the media storage destroy but still drops the DB row (#4)', async () => {
    const { cron, productImage, productVariantImage, media } = build();
    productImage.findMany.mockResolvedValueOnce([{ id: 'img-1', publicId: 'shared' }]);
    // A LIVE variant image still references the same publicId.
    productImage.count.mockResolvedValueOnce(0); // live ProductImage check
    productVariantImage.count.mockResolvedValueOnce(1); // live ProductVariantImage check

    const out = await sweepOnce(cron);

    expect(media.delete).not.toHaveBeenCalled();
    expect(productImage.deleteMany).toHaveBeenCalled();
    expect(out.skippedShared).toBe(1);
    expect(out.deleted).toBe(1);
  });

  it('CAS lost: parent restored under us → DB row left intact, not counted deleted (#19)', async () => {
    const { cron, productImage, media } = build();
    productImage.findMany.mockResolvedValueOnce([{ id: 'img-1', publicId: 'pid-1' }]);
    productImage.deleteMany.mockResolvedValueOnce({ count: 0 }); // CAS miss

    const out = await sweepOnce(cron);

    expect(media.delete).toHaveBeenCalledWith('pid-1');
    expect(out.deleted).toBe(0);
  });

  it('persistent failure escalates to deleteFailed past the retry cap (#5)', async () => {
    const { cron, productImage, media } = build();
    productImage.findMany.mockResolvedValueOnce([{ id: 'img-1', publicId: 'pid-1' }]);
    media.delete.mockRejectedValueOnce(new Error('media 5xx'));
    // retry cap defaults to 5; this attempt reaches it.
    productImage.update.mockResolvedValueOnce({ deleteAttemptCount: 5 });

    const out = await sweepOnce(cron);

    expect(out.failed).toBe(1);
    expect(out.escalated).toBe(1);
    // first update bumps the counter…
    expect(productImage.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'img-1' },
        data: expect.objectContaining({ deleteAttemptCount: { increment: 1 } }),
      }),
    );
    // …second update flips the escalation marker.
    expect(productImage.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'img-1' },
        data: { deleteFailed: true },
      }),
    );
  });

  it('excludes already-failed rows from the scan (deleteFailed=false filter)', async () => {
    const { cron, productImage } = build();
    await sweepOnce(cron);
    expect(productImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deleteFailed: false }),
      }),
    );
  });
});
