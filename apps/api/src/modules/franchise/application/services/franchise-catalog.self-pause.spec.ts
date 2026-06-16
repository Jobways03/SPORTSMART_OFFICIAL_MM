import { FranchiseCatalogService } from './franchise-catalog.service';
import {
  NotFoundAppException,
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

/**
 * Franchise self-pause / self-resume guards.
 *
 * Mirrors the seller per-mapping pause feature for the 3rd seller type.
 * The security-critical invariants pinned here:
 *   - a franchise can only pause/resume a mapping it OWNS;
 *   - only an APPROVED, live mapping can be paused;
 *   - resume lifts ONLY a self-pause (stoppedById === franchiseId) — an
 *     admin STOP is NOT franchise-resumable;
 *   - listMappings derives canPause/canResume per row, and canResume is
 *     false for an admin STOP.
 */

const FR = 'franchise-1';
const OTHER_FR = 'franchise-2';
const ADMIN = 'admin-user-9';

function build(opts: {
  findById?: any;
  pauseResult?: any;
  resumeResult?: any;
  listRows?: any[];
}) {
  const pauseByFranchise = jest.fn().mockResolvedValue(opts.pauseResult ?? null);
  const resumeByFranchise = jest
    .fn()
    .mockResolvedValue(opts.resumeResult ?? null);
  const findById = jest.fn().mockResolvedValue(opts.findById ?? null);
  const findByFranchiseId = jest
    .fn()
    .mockResolvedValue({ mappings: opts.listRows ?? [], total: (opts.listRows ?? []).length });

  const repo: any = {
    findById,
    pauseByFranchise,
    resumeByFranchise,
    findByFranchiseId,
  };
  const prisma: any = {};
  const service = new FranchiseCatalogService(repo, prisma);
  return { service, repo, pauseByFranchise, resumeByFranchise, findById };
}

describe('FranchiseCatalogService — self-pause', () => {
  it('pauses an APPROVED mapping the franchise owns', async () => {
    const { service, pauseByFranchise } = build({
      findById: { id: 'm1', franchiseId: FR, approvalStatus: 'APPROVED' },
      pauseResult: { id: 'm1', franchiseId: FR, approvalStatus: 'STOPPED' },
    });
    const res = await service.pauseMapping(FR, 'm1', 'going on holiday');
    expect(res).toEqual({ id: 'm1', franchiseId: FR, approvalStatus: 'STOPPED' });
    expect(pauseByFranchise).toHaveBeenCalledWith('m1', FR, 'going on holiday');
  });

  it('refuses to pause a mapping owned by another franchise (NotFound)', async () => {
    const { service, pauseByFranchise } = build({
      findById: { id: 'm1', franchiseId: OTHER_FR, approvalStatus: 'APPROVED' },
    });
    await expect(service.pauseMapping(FR, 'm1')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(pauseByFranchise).not.toHaveBeenCalled();
  });

  it('refuses to pause a non-APPROVED mapping (BadRequest)', async () => {
    const { service, pauseByFranchise } = build({
      findById: { id: 'm1', franchiseId: FR, approvalStatus: 'PENDING_APPROVAL' },
    });
    await expect(service.pauseMapping(FR, 'm1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(pauseByFranchise).not.toHaveBeenCalled();
  });

  it('surfaces a lost race (repo returns null) as Conflict', async () => {
    const { service } = build({
      findById: { id: 'm1', franchiseId: FR, approvalStatus: 'APPROVED' },
      pauseResult: null,
    });
    await expect(service.pauseMapping(FR, 'm1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });
});

describe('FranchiseCatalogService — self-resume', () => {
  it('resumes a SELF-paused mapping', async () => {
    const { service, resumeByFranchise } = build({
      findById: {
        id: 'm1',
        franchiseId: FR,
        approvalStatus: 'STOPPED',
        stoppedById: FR,
      },
      resumeResult: { id: 'm1', franchiseId: FR, approvalStatus: 'APPROVED' },
    });
    const res = await service.resumeMapping(FR, 'm1');
    expect(res.approvalStatus).toBe('APPROVED');
    expect(resumeByFranchise).toHaveBeenCalledWith('m1', FR);
  });

  it('refuses to resume an ADMIN stop (stoppedById !== franchiseId)', async () => {
    const { service, resumeByFranchise } = build({
      findById: {
        id: 'm1',
        franchiseId: FR,
        approvalStatus: 'STOPPED',
        stoppedById: ADMIN, // admin stopped it
      },
    });
    await expect(service.resumeMapping(FR, 'm1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(resumeByFranchise).not.toHaveBeenCalled();
  });

  it('refuses to resume a mapping owned by another franchise (NotFound)', async () => {
    const { service } = build({
      findById: {
        id: 'm1',
        franchiseId: OTHER_FR,
        approvalStatus: 'STOPPED',
        stoppedById: OTHER_FR,
      },
    });
    await expect(service.resumeMapping(FR, 'm1')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});

describe('FranchiseCatalogService — listMappings derives offer controls', () => {
  it('marks an approved live row canPause, a self-paused row canResume, and an admin-stop row neither', async () => {
    const { service } = build({
      listRows: [
        { id: 'live', approvalStatus: 'APPROVED', isActive: true, removedAt: null },
        {
          id: 'self',
          approvalStatus: 'STOPPED',
          isActive: false,
          stoppedById: FR,
          removedAt: null,
        },
        {
          id: 'adminstop',
          approvalStatus: 'STOPPED',
          isActive: false,
          stoppedById: ADMIN,
          removedAt: null,
        },
        {
          id: 'removed',
          approvalStatus: 'STOPPED',
          isActive: false,
          stoppedById: FR,
          removedAt: new Date(),
        },
      ],
    });
    const res = await service.listMappings(FR, { page: 1, limit: 20 });
    const byId = Object.fromEntries(res.mappings.map((m: any) => [m.id, m]));
    expect(byId.live.canPause).toBe(true);
    expect(byId.live.canResume).toBe(false);
    expect(byId.self.canResume).toBe(true);
    expect(byId.self.canPause).toBe(false);
    // an admin STOP is NOT franchise-resumable
    expect(byId.adminstop.canResume).toBe(false);
    expect(byId.adminstop.canPause).toBe(false);
    // a soft-removed row offers neither, even though it was self-paused
    expect(byId.removed.canResume).toBe(false);
    expect(byId.removed.canPause).toBe(false);
  });
});
