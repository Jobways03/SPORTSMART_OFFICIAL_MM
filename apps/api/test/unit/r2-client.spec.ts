import 'reflect-metadata';
import { R2Client } from '../../src/integrations/r2/clients/r2.client';
import { R2Adapter } from '../../src/integrations/r2/adapters/r2.adapter';

/**
 * R2 integration — config gating. Replaces the old s3-stub-fails-loud test.
 * When the bucket/creds/endpoint are absent the client reports
 * not-configured and the adapter refuses presigned ops / no-ops deletes
 * (so callers fall back rather than hit an unconfigured SDK call).
 */
const envWith = (vals: Record<string, string>) =>
  ({ getOptional: (k: string) => vals[k] }) as any;

describe('R2Client — config gating', () => {
  it('is not configured when env is absent', () => {
    const c = new R2Client(envWith({}));
    c.onModuleInit();
    expect(c.isConfigured).toBe(false);
  });

  it('is configured when account/bucket/creds are present', () => {
    const c = new R2Client(
      envWith({
        R2_ACCOUNT_ID: 'acct123',
        R2_BUCKET: 'media',
        R2_ACCESS_KEY_ID: 'ak',
        R2_SECRET_ACCESS_KEY: 'sk',
      }),
    );
    c.onModuleInit();
    expect(c.isConfigured).toBe(true);
  });

  it('generateKey is UUID-scoped under the folder, preserving extension', () => {
    const c = new R2Client(envWith({}));
    c.onModuleInit();
    const key = c.generateKey('sportsmart/kyc', 'my doc.PDF');
    expect(key).toMatch(/^sportsmart\/kyc\/[0-9a-f-]{36}\.PDF$/i);
  });
});

describe('R2Adapter — refuses when unconfigured', () => {
  const unconfigured = () => {
    const c = new R2Client(envWith({}));
    c.onModuleInit();
    return new R2Adapter(c);
  };

  it('createUploadUrl throws when not configured', async () => {
    await expect(
      unconfigured().createUploadUrl({ folder: 'x', filename: 'f.png', contentType: 'image/png' }),
    ).rejects.toThrow(/not configured/i);
  });

  it('deleteFile is a no-op (no throw) when not configured', async () => {
    await expect(unconfigured().deleteFile('some/key.png')).resolves.toBeUndefined();
  });
});
