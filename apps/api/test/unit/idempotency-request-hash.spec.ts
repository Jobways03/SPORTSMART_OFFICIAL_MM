import 'reflect-metadata';
import {
  computeRequestHash,
  extractActor,
} from '../../src/core/idempotency/request-hash.util';

describe('computeRequestHash', () => {
  const baseReq = (overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      method: 'POST',
      path: '/customer/returns',
      route: { path: '/customer/returns' },
      body: {},
      ...overrides,
    }) as any;

  it('produces stable output for the same request', () => {
    const a = computeRequestHash(baseReq({ body: { foo: 'bar', n: 1 } }));
    const b = computeRequestHash(baseReq({ body: { foo: 'bar', n: 1 } }));
    expect(a).toBe(b);
  });

  it('is independent of body key order', () => {
    const a = computeRequestHash(baseReq({ body: { foo: 'bar', n: 1 } }));
    const b = computeRequestHash(baseReq({ body: { n: 1, foo: 'bar' } }));
    expect(a).toBe(b);
  });

  it('detects different methods', () => {
    const a = computeRequestHash(baseReq({ method: 'POST' }));
    const b = computeRequestHash(baseReq({ method: 'PATCH' }));
    expect(a).not.toBe(b);
  });

  it('detects different routes', () => {
    const a = computeRequestHash(baseReq({ route: { path: '/a' } }));
    const b = computeRequestHash(baseReq({ route: { path: '/b' } }));
    expect(a).not.toBe(b);
  });

  it('detects different bodies', () => {
    const a = computeRequestHash(baseReq({ body: { qty: 1 } }));
    const b = computeRequestHash(baseReq({ body: { qty: 2 } }));
    expect(a).not.toBe(b);
  });

  it('handles arrays deterministically', () => {
    const a = computeRequestHash(baseReq({ body: { items: [1, 2, 3] } }));
    const b = computeRequestHash(baseReq({ body: { items: [1, 2, 3] } }));
    expect(a).toBe(b);
  });

  it('treats array element order as significant', () => {
    // Important: we should not silently mask "items reordered" as the
    // same request — order may change billing line semantics.
    const a = computeRequestHash(baseReq({ body: { items: [1, 2] } }));
    const b = computeRequestHash(baseReq({ body: { items: [2, 1] } }));
    expect(a).not.toBe(b);
  });
});

describe('extractActor', () => {
  it('returns ADMIN for admin requests', () => {
    expect(extractActor({ adminId: 'a1' } as any)).toEqual({
      type: 'ADMIN',
      id: 'a1',
    });
  });

  it('returns CUSTOMER for user requests', () => {
    expect(extractActor({ userId: 'u1' } as any)).toEqual({
      type: 'CUSTOMER',
      id: 'u1',
    });
  });

  it('falls back to ANONYMOUS when nothing is set', () => {
    expect(extractActor({} as any)).toEqual({ type: 'ANONYMOUS', id: '-' });
  });

  it('prefers admin over user when both are set', () => {
    // E.g. an admin impersonating a customer — the admin should be
    // the audited actor for idempotency replay purposes.
    expect(extractActor({ adminId: 'a1', userId: 'u1' } as any)).toEqual({
      type: 'ADMIN',
      id: 'a1',
    });
  });
});
