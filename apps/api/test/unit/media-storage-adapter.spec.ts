import 'reflect-metadata';
import sharp from 'sharp';
import { MediaStorageAdapter } from '../../src/integrations/media/media-storage.adapter';

/**
 * Media storage adapter — Cloudflare R2 (+ sharp) is the ONLY backend
 * (media fully removed). When R2 is usable (creds + a public delivery
 * base) uploads/deletes/URLs route to R2 (sharp strips EXIF + yields real
 * dimensions). When it isn't, dev/test fall back to a deterministic dev-stub
 * placeholder so upload-dependent flows stay testable; prod throws.
 */
const logger: any = {
  setContext: () => {},
  log: () => {},
  warn: () => {},
  error: () => {},
};

const envWith = (vals: Record<string, string>) => ({ getOptional: (k: string) => vals[k] }) as any;

function r2Mock(isConfigured: boolean) {
  return {
    isConfigured,
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    generateKey: (folder: string, filename: string) =>
      `${folder}/uuid.${filename.split('.').pop() || 'bin'}`,
    publicUrlFor: (k: string) => `https://media.test/${k}`,
  } as any;
}

describe('MediaStorageAdapter — R2 active', () => {
  const env = envWith({ R2_PUBLIC_BASE_URL: 'https://media.test', NODE_ENV: 'test' });

  it('providerTag is always r2', () => {
    const a = new MediaStorageAdapter(env, logger, r2Mock(true));
    expect(a.providerTag).toBe('r2');
  });

  it('upload stores in R2 via sharp, strips EXIF, returns real dimensions + public URL', async () => {
    const r2 = r2Mock(true);
    const a = new MediaStorageAdapter(env, logger, r2);
    const png = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const res = await a.upload(png, { folder: 'sportsmart/products', resourceType: 'image' });
    expect(r2.putObject).toHaveBeenCalledTimes(1);
    expect(res.publicId).toMatch(/^sportsmart\/products\/uuid\.png$/);
    expect(res.width).toBe(3);
    expect(res.height).toBe(2);
    expect(res.format).toBe('png');
    expect(res.secureUrl).toBe(`https://media.test/${res.publicId}`);
  });

  it('deleteAsset routes to R2 deleteObject', async () => {
    const r2 = r2Mock(true);
    const a = new MediaStorageAdapter(env, logger, r2);
    const out = await a.deleteAsset('sportsmart/kyc/uuid.png');
    expect(r2.deleteObject).toHaveBeenCalledWith('sportsmart/kyc/uuid.png');
    expect(out).toEqual({ ok: true });
  });

  it('urlFor returns the R2 public delivery URL', () => {
    const a = new MediaStorageAdapter(env, logger, r2Mock(true));
    expect(a.urlFor('sportsmart/products/uuid.png')).toBe(
      'https://media.test/sportsmart/products/uuid.png',
    );
  });
});

describe('MediaStorageAdapter — dev-stub fallback when R2 not configured', () => {
  it('upload falls back to the dev-stub in test when R2 has no creds', async () => {
    const env = envWith({ R2_PUBLIC_BASE_URL: 'https://media.test', NODE_ENV: 'test' });
    const r2 = r2Mock(false); // not configured
    const a = new MediaStorageAdapter(env, logger, r2);
    const res = await a.upload(Buffer.from('x'), { folder: 'sportsmart/kyc', resourceType: 'image' });
    expect(res.publicId).toMatch(/^dev-stub\//);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('upload falls back to the dev-stub when no public delivery base is set', async () => {
    const env = envWith({ NODE_ENV: 'test' }); // no R2_PUBLIC_BASE_URL
    const r2 = r2Mock(true);
    const a = new MediaStorageAdapter(env, logger, r2);
    const res = await a.upload(Buffer.from('x'), { folder: 'sportsmart/kyc', resourceType: 'image' });
    expect(res.publicId).toMatch(/^dev-stub\//);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('deleteAsset on a dev-stub publicId is a no-op success (never reached storage)', async () => {
    const env = envWith({ NODE_ENV: 'test' });
    const r2 = r2Mock(false);
    const a = new MediaStorageAdapter(env, logger, r2);
    const out = await a.deleteAsset('dev-stub/sportsmart_kyc/uuid');
    expect(out).toEqual({ ok: true });
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });
});
