// Phase 117 — ticket-category CRUD hardening.
//
//   - duplicate name (P2002 on the @unique) now surfaces as a 409
//     ConflictAppException, not a raw 500.
//   - create / update / soft-delete now write an audit_logs row (so
//     "who disabled this category?" is answerable).

import { Prisma } from '@prisma/client';
import { SupportService } from './support.service';
import { ConflictAppException } from '../../../../core/exceptions';

function build(repoOverrides: any = {}) {
  const repo: any = {
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    ...repoOverrides,
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupportService(
    repo,
    {} as any, // prisma
    {} as any, // eventBus
    {} as any, // caseDuplicates
    {} as any, // disputes
    {} as any, // env
    audit as any,
  );
  return { svc, repo, audit };
}

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  } as any);

describe('SupportService category CRUD (Phase 117)', () => {
  it('maps a duplicate-name P2002 to a 409 ConflictAppException on create', async () => {
    const { svc, repo } = build();
    repo.createCategory.mockRejectedValue(p2002());
    await expect(
      svc.createCategory({ name: 'Refunds' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('audits a successful create as support.category.created', async () => {
    const { svc, repo, audit } = build();
    repo.createCategory.mockResolvedValue({
      id: 'c-1', name: 'Refunds', scopedTo: null, sortOrder: 0,
    });
    await svc.createCategory({ name: 'Refunds' }, 'admin-1');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.category.created',
        resourceId: 'c-1',
        actorId: 'admin-1',
      }),
    );
  });

  it('audits a soft-delete (active:false) distinctly as support.category.deactivated', async () => {
    const { svc, repo, audit } = build();
    repo.updateCategory.mockResolvedValue({ id: 'c-1', active: false });
    await svc.updateCategory('c-1', { active: false }, 'admin-1');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.category.deactivated',
        resourceId: 'c-1',
      }),
    );
  });

  it('audits a normal update as support.category.updated', async () => {
    const { svc, repo, audit } = build();
    repo.updateCategory.mockResolvedValue({ id: 'c-1', name: 'Renamed' });
    await svc.updateCategory('c-1', { name: 'Renamed' }, 'admin-1');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'support.category.updated' }),
    );
  });

  it('rejects an empty name on create before hitting the repo', async () => {
    const { svc, repo } = build();
    await expect(svc.createCategory({ name: '  ' }, 'admin-1')).rejects.toThrow(
      /name is required/i,
    );
    expect(repo.createCategory).not.toHaveBeenCalled();
  });
});
