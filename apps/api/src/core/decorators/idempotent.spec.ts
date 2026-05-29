// Phase 95 (2026-05-23) — coverage for the Idempotent decorator's
// new optional ttl arg (Phase 93 deferred #17 closure).

import { Reflector } from '@nestjs/core';
import {
  Idempotent,
  IDEMPOTENT_KEY,
  IDEMPOTENT_TTL_KEY,
} from './idempotent.decorator';

class TestController {
  @Idempotent()
  noTtlHandler() {}

  @Idempotent({ ttl: 3600 })
  withTtlHandler() {}

  @Idempotent({ ttl: 60 * 60 * 24 * 7 })
  weekTtlHandler() {}
}

describe('Idempotent decorator', () => {
  const reflector = new Reflector();

  it('marks the handler as idempotent', () => {
    expect(
      reflector.get(IDEMPOTENT_KEY, TestController.prototype.noTtlHandler),
    ).toBe(true);
    expect(
      reflector.get(IDEMPOTENT_KEY, TestController.prototype.withTtlHandler),
    ).toBe(true);
  });

  it('omits TTL metadata when arg omitted', () => {
    expect(
      reflector.get(IDEMPOTENT_TTL_KEY, TestController.prototype.noTtlHandler),
    ).toBeUndefined();
  });

  it('stores TTL metadata when arg given', () => {
    expect(
      reflector.get(IDEMPOTENT_TTL_KEY, TestController.prototype.withTtlHandler),
    ).toBe(3600);
  });

  it('preserves large TTL values', () => {
    expect(
      reflector.get(IDEMPOTENT_TTL_KEY, TestController.prototype.weekTtlHandler),
    ).toBe(60 * 60 * 24 * 7);
  });
});
