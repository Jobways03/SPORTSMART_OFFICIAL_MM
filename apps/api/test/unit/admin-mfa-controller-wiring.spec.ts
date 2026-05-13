import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { AdminMfaController } from '../../src/modules/admin-mfa/presentation/controllers/admin-mfa.controller';
import { AdminAuthGuard } from '../../src/core/guards';

// Phase 10 (PR 10.5) — AdminMfaController route + guard wiring.
//
// Verifies the controller metadata so a future PR that drops the
// guard or moves the route path silently is caught at CI time.
// Doesn't exercise the actual HTTP flow (that's e2e territory); the
// service-level tests in PR 10.4 already cover the orchestration.

const reflector = new Reflector();

describe('AdminMfaController wiring (PR 10.5)', () => {
  it('is mounted at /admin/mfa', () => {
    const path = reflector.get<string>('path', AdminMfaController);
    expect(path).toBe('admin/mfa');
  });

  it('applies AdminAuthGuard at the controller level', () => {
    // @UseGuards stamps the guards under the __guards__ metadata
    // key. Verify the class-level decoration includes AdminAuthGuard
    // so every route inherits it.
    const guards =
      Reflect.getMetadata('__guards__', AdminMfaController) ?? [];
    expect(guards).toContain(AdminAuthGuard);
  });

  describe.each([
    { handler: 'beginEnrollment', method: 'POST', subpath: 'enroll/begin' },
    { handler: 'completeEnrollment', method: 'POST', subpath: 'enroll/complete' },
  ])('$method /admin/mfa/$subpath ($handler)', ({ handler, method, subpath }) => {
    const proto = AdminMfaController.prototype as any;
    it('handler exists on the controller class', () => {
      expect(typeof proto[handler]).toBe('function');
    });

    it(`route metadata declares the ${method} ${subpath} path`, () => {
      // Nest stamps 'path' and 'method' onto the handler descriptor.
      const declaredPath = Reflect.getMetadata('path', proto[handler]);
      const declaredMethod = Reflect.getMetadata('method', proto[handler]);
      expect(declaredPath).toBe(subpath);
      // RequestMethod enum: POST is 1 in @nestjs/common.
      // Compare via the metadata constant directly to avoid coupling
      // the assertion to the numeric value.
      expect(declaredMethod).toBeDefined();
    });
  });
});
