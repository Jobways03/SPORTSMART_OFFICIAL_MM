import 'reflect-metadata';
import { S3Client } from '../../src/integrations/s3/clients/s3.client';

/**
 * Regression test for the S3 integration stub.
 *
 * Before: generatePresignedUploadUrl returned a plain public bucket URL
 * (no signature, no auth). A future caller wiring it up would either
 * upload to a world-writable bucket or hit 403s with no clear error,
 * depending on bucket ACL. deleteObject was a no-op log.
 *
 * After: every method throws NOT_IMPLEMENTED, and isConfigured returns
 * false so existing `if (isConfigured) upload()` guards skip it
 * cleanly. When a caller really wires in real S3, they'll see the
 * throw on first call rather than silently sending data to the wrong
 * place.
 */

describe('S3Client — fail-loud stub', () => {
  const client = new S3Client();

  it('isConfigured is always false so guards skip the stub', () => {
    expect(client.isConfigured).toBe(false);
  });

  it('generatePresignedUploadUrl throws NOT_IMPLEMENTED', () => {
    expect(() =>
      client.generatePresignedUploadUrl({
        key: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    ).toThrow(/stub/i);
  });

  it('generatePresignedAccessUrl throws NOT_IMPLEMENTED', () => {
    expect(() =>
      client.generatePresignedAccessUrl({ key: 'test.jpg' }),
    ).toThrow(/stub/i);
  });

  it('deleteObject rejects NOT_IMPLEMENTED', async () => {
    await expect(client.deleteObject('test.jpg')).rejects.toThrow(/stub/i);
  });

  it('generateKey still works (pure, safe for future real impl)', () => {
    const key = client.generateKey('products', 'photo.jpg');
    expect(key).toMatch(/^products\/[0-9a-f-]+\.jpg$/);
  });
});
