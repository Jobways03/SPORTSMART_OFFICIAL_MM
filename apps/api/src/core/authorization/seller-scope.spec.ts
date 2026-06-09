import { resolveSellerScope, scopeAllowsType } from './seller-scope';

describe('resolveSellerScope', () => {
  it('is unrestricted when no scope permission is held (legacy default)', () => {
    const s = resolveSellerScope(['sellers.read', 'sellers.approve']);
    expect(s.unrestricted).toBe(true);
    expect(s.allowed).toEqual([]);
  });

  it('is unrestricted for empty / undefined / null permission sets', () => {
    expect(resolveSellerScope([]).unrestricted).toBe(true);
    expect(resolveSellerScope(undefined).unrestricted).toBe(true);
    expect(resolveSellerScope(null).unrestricted).toBe(true);
  });

  it('restricts to D2C when only the d2c scope is held', () => {
    const s = resolveSellerScope(['sellers.read', 'sellers.scope.d2c']);
    expect(s).toEqual({ unrestricted: false, allowed: ['D2C'] });
  });

  it('restricts to RETAIL when only the retail scope is held', () => {
    const s = resolveSellerScope(['sellers.scope.retail']);
    expect(s).toEqual({ unrestricted: false, allowed: ['RETAIL'] });
  });

  it('allows both types when both scopes are held (e.g. SUPER_ADMIN)', () => {
    const s = resolveSellerScope(['sellers.scope.d2c', 'sellers.scope.retail']);
    expect(s.unrestricted).toBe(false);
    expect(s.allowed).toEqual(['D2C', 'RETAIL']);
  });
});

describe('scopeAllowsType', () => {
  it('an unrestricted scope allows any type, including null', () => {
    const s = resolveSellerScope([]);
    expect(scopeAllowsType(s, 'D2C')).toBe(true);
    expect(scopeAllowsType(s, 'RETAIL')).toBe(true);
    expect(scopeAllowsType(s, null)).toBe(true);
  });

  it('a restricted scope allows only in-scope types (and never null/unknown)', () => {
    const s = resolveSellerScope(['sellers.scope.d2c']);
    expect(scopeAllowsType(s, 'D2C')).toBe(true);
    expect(scopeAllowsType(s, 'RETAIL')).toBe(false);
    expect(scopeAllowsType(s, null)).toBe(false);
    expect(scopeAllowsType(s, undefined)).toBe(false);
  });
});
