// Phase 250/252/253 — security behaviours of the file pipeline:
// the getSecureUrl IDOR ACL, attach ownership/compat/allowlist, magic-byte
// content validation, and soft-delete provider erasure.
import { FileService } from './file.service';

function makeService() {
  const prisma: any = {
    fileMetadata: {
      findUnique: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({ id: 'f1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'f1', ...data })),
    },
    fileAttachment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'att1', ...data })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(),
    },
  };
  const cloudinary: any = {
    upload: jest.fn(async () => ({ publicId: 'pid', secureUrl: 'https://res/x.png' })),
    urlFor: jest.fn(() => 'https://res.cloudinary.com/x.png'),
    deleteAsset: jest.fn(async () => ({ ok: true })),
  };
  const s3: any = {};
  const svc = new FileService(prisma, cloudinary, s3);
  return { svc, prisma, cloudinary };
}

const privateFile = (over: Record<string, any> = {}) => ({
  id: 'f1',
  purpose: 'KYC_DOCUMENT',
  status: 'READY',
  uploadedBy: 'u1',
  provider: 'cloudinary',
  providerFileId: 'pid',
  storageKey: 'pid',
  mimeType: 'image/png',
  providerUrl: null,
  deletedAt: null,
  ...over,
});

describe('FileService.getSecureUrl — IDOR ACL (#252.14)', () => {
  it('rejects a non-owner, non-admin caller for a PRIVATE file', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile());
    await expect(
      svc.getSecureUrl('f1', { actorId: 'u2', actorType: 'CUSTOMER', isAdmin: false }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('allows the uploader', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile());
    await expect(
      svc.getSecureUrl('f1', { actorId: 'u1', actorType: 'AFFILIATE', isAdmin: false }),
    ).resolves.toContain('cloudinary');
  });

  it('allows an admin', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile());
    await expect(
      svc.getSecureUrl('f1', { actorId: 'admin1', actorType: 'ADMIN', isAdmin: true }),
    ).resolves.toBeTruthy();
  });

  it('allows anyone for a PUBLIC file', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(
      privateFile({ purpose: 'PRODUCT_IMAGE', providerUrl: 'https://res/pub.png' }),
    );
    await expect(
      svc.getSecureUrl('f1', { actorId: 'stranger', actorType: 'CUSTOMER', isAdmin: false }),
    ).resolves.toBe('https://res/pub.png');
  });
});

describe('FileService.attach — ownership / compat / allowlist (#252)', () => {
  it('rejects attaching a file the caller does not own', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(
      privateFile({ purpose: 'PRODUCT_IMAGE', uploadedBy: 'u1' }),
    );
    await expect(
      svc.attach({ fileId: 'f1', resource: 'product', resourceId: 'p1', attachedBy: 'u2' }),
    ).rejects.toThrow(/not allowed to attach/i);
  });

  it('rejects an incompatible purpose↔resource (KYC as product_image)', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile({ purpose: 'KYC_DOCUMENT', uploadedBy: 'u1' }));
    await expect(
      svc.attach({ fileId: 'f1', resource: 'product', resourceId: 'p1', attachedBy: 'u1' }),
    ).rejects.toThrow(/cannot be attached/i);
  });

  it('rejects an unknown resource', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile({ purpose: 'PRODUCT_IMAGE', uploadedBy: 'u1' }));
    await expect(
      svc.attach({ fileId: 'f1', resource: 'admin_user', resourceId: 'x', attachedBy: 'u1' }),
    ).rejects.toThrow(/unsupported attach resource/i);
  });

  it('allows the owner to attach to a compatible resource', async () => {
    const { svc, prisma } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile({ purpose: 'PRODUCT_IMAGE', uploadedBy: 'u1' }));
    const row = await svc.attach({ fileId: 'f1', resource: 'product', resourceId: 'p1', attachedBy: 'u1' });
    expect(row).toMatchObject({ resource: 'product', resourceId: 'p1' });
  });
});

describe('FileService.uploadDirect — magic-byte content check (#250.3)', () => {
  it('rejects a non-image masquerading as image/jpeg', async () => {
    const { svc } = makeService();
    const file: any = {
      originalname: 'evil.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('this is plain text, not a JPEG at all'),
      size: 37,
    };
    await expect(
      svc.uploadDirect({ purpose: 'PRODUCT_IMAGE', file, uploadedBy: 'u1' }),
    ).rejects.toThrow(/could not verify|does not match/i);
  });

  it('accepts a real PNG (magic bytes match)', async () => {
    const { svc, cloudinary } = makeService();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const file: any = { originalname: 'p.png', mimetype: 'image/png', buffer: png, size: png.length };
    await svc.uploadDirect({ purpose: 'PRODUCT_IMAGE', file, uploadedBy: 'u1', uploadedByType: 'SELLER' });
    expect(cloudinary.upload).toHaveBeenCalled();
  });
});

describe('FileService.softDelete — provider erasure (#253.2)', () => {
  it('destroys the media asset, not just the DB row', async () => {
    const { svc, prisma, cloudinary } = makeService();
    prisma.fileMetadata.findUnique.mockResolvedValue(privateFile({ uploadedBy: 'u1' }));
    await svc.softDelete('f1', 'u1', false);
    expect(cloudinary.deleteAsset).toHaveBeenCalledWith('pid', expect.anything());
    expect(prisma.fileMetadata.update).toHaveBeenCalled();
    expect(prisma.fileAttachment.deleteMany).toHaveBeenCalledWith({ where: { fileId: 'f1' } });
  });
});
