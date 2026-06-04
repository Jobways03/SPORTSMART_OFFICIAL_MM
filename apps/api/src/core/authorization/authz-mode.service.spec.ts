import { AuthzModeService } from './authz-mode.service';

function make(envStrict: boolean) {
  const env = {
    getBoolean: (k: string, d: boolean) =>
      k === 'PERMISSIONS_GUARD_STRICT' ? envStrict : d,
  } as any;
  const prisma = {
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create, update }: any) =>
        Promise.resolve({
          ...(create ?? update),
          updatedAt: new Date(),
          updatedByAdminId: 'a',
        }),
      ),
    },
  } as any;
  return new AuthzModeService(env, prisma);
}

describe('AuthzModeService — tighten-only OR-semantics (security invariant)', () => {
  it('override can ENABLE strict when the env baseline is soak', async () => {
    const svc = make(false);
    expect(svc.isStrict()).toBe(false);
    await svc.setOverride({ strictMode: true }, 'admin-1');
    expect(svc.isStrict()).toBe(true);
  });

  it('override CANNOT disable a deploy-mandated strict (env=true)', async () => {
    const svc = make(true);
    expect(svc.isStrict()).toBe(true);
    await svc.setOverride({ strictMode: false }, 'admin-1');
    // tighten-only: env baseline wins — a runtime override never weakens.
    expect(svc.isStrict()).toBe(true);
  });

  it('rolls back to the env baseline when the override is cleared (env=soak)', async () => {
    const svc = make(false);
    await svc.setOverride({ strictMode: true }, 'admin-1');
    expect(svc.isStrict()).toBe(true);
    await svc.setOverride({ strictMode: false }, 'admin-1');
    expect(svc.isStrict()).toBe(false);
  });

  it('getModeInfo reports env vs override vs effective + source', async () => {
    const svc = make(false);
    await svc.setOverride({ strictMode: true }, 'admin-1');
    const info = svc.getModeInfo();
    expect(info.strictMode.env).toBe(false);
    expect(info.strictMode.override).toBe(true);
    expect(info.strictMode.effective).toBe(true);
    expect(info.source).toBe('env+db');
  });
});
