import { GoogleLoginUseCase } from './google-login.use-case';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { GoogleIdentity } from '../../../../integrations/google/google-id-token-verifier.service';
import { UserWithRoles } from '../../domain/repositories/user.repository';

/**
 * "Sign in with Google" — login/registration routing.
 *
 * The verifier (network/JWKS), the user repo (DB), and the session mint
 * (JWT/Redis) are ALL mocked. These tests assert ONLY the decision
 * routing the use case is responsible for:
 *   (a) unverified Google email → 401, and NOTHING is written;
 *   (b) existing AuthIdentity(sub) → session, no link, no create;
 *   (c) no link but verified-email match → auto-link + session, no create;
 *   (d) brand-new → createGoogleCustomer (carrying consent rows; the repo
 *       contract owns CUSTOMER role + emailVerified) + session;
 *   (e) a moderated (SUSPENDED/BANNED/INACTIVE) account → uniform 401
 *       on every resolution branch, and never mints a session.
 */

const noopLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const SENTINEL_SESSION = {
  accessToken: 'access.jwt',
  refreshToken: 'refresh-uuid',
  expiresIn: 900,
  user: {
    userId: 'will-be-overwritten',
    email: 'x',
    firstName: 'x',
    lastName: 'x',
  },
};

function buildVerifier(identity: Partial<GoogleIdentity>) {
  return {
    verify: jest.fn().mockResolvedValue({
      sub: 'google-sub',
      email: 'user@example.com',
      emailVerified: true,
      firstName: 'Test',
      lastName: 'User',
      ...identity,
    } as GoogleIdentity),
  } as any;
}

function buildUserRepo(overrides: Record<string, any> = {}) {
  return {
    findUserByAuthIdentity: jest.fn().mockResolvedValue(null),
    findByEmailWithRoles: jest.fn().mockResolvedValue(null),
    linkGoogleIdentityAndActivate: jest.fn(),
    createGoogleCustomer: jest.fn(),
    ...overrides,
  } as any;
}

function buildLoginUseCase() {
  return {
    issueCustomerSession: jest.fn().mockResolvedValue(SENTINEL_SESSION),
  } as any;
}

function customer(overrides: Partial<UserWithRoles> = {}): UserWithRoles {
  return {
    id: 'user-1',
    firstName: 'Test',
    lastName: 'User',
    email: 'user@example.com',
    passwordHash: null,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockUntil: null,
    roleAssignments: [{ role: { name: 'CUSTOMER' } }],
    ...overrides,
  };
}

const ctx = { credential: 'cred', userAgent: 'jest-ua', ipAddress: '1.2.3.4' };

describe('GoogleLoginUseCase', () => {
  describe('(a) unverified Google email', () => {
    it('rejects with 401 and creates / links / mints NOTHING', async () => {
      const verifier = buildVerifier({ emailVerified: false });
      const userRepo = buildUserRepo();
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      await expect(uc.execute(ctx)).rejects.toBeInstanceOf(
        UnauthorizedAppException,
      );

      expect(userRepo.findUserByAuthIdentity).not.toHaveBeenCalled();
      expect(userRepo.findByEmailWithRoles).not.toHaveBeenCalled();
      expect(userRepo.linkGoogleIdentityAndActivate).not.toHaveBeenCalled();
      expect(userRepo.createGoogleCustomer).not.toHaveBeenCalled();
      expect(loginUseCase.issueCustomerSession).not.toHaveBeenCalled();
    });

    it('verified token but EMPTY email claim → 401, nothing written', async () => {
      const verifier = buildVerifier({ emailVerified: true, email: '' });
      const userRepo = buildUserRepo();
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      await expect(uc.execute(ctx)).rejects.toBeInstanceOf(
        UnauthorizedAppException,
      );
      expect(userRepo.createGoogleCustomer).not.toHaveBeenCalled();
      expect(loginUseCase.issueCustomerSession).not.toHaveBeenCalled();
    });
  });

  describe('(b) returning Google user — AuthIdentity(sub) hit', () => {
    it('returns a session WITHOUT linking or creating', async () => {
      const existing = customer({ id: 'returning-1' });
      const verifier = buildVerifier({});
      const userRepo = buildUserRepo({
        findUserByAuthIdentity: jest.fn().mockResolvedValue(existing),
      });
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      const result = await uc.execute(ctx);

      expect(result).toBe(SENTINEL_SESSION);
      expect(userRepo.findUserByAuthIdentity).toHaveBeenCalledWith(
        'google',
        'google-sub',
      );
      // First hit wins: no email lookup, no link, no create.
      expect(userRepo.findByEmailWithRoles).not.toHaveBeenCalled();
      expect(userRepo.linkGoogleIdentityAndActivate).not.toHaveBeenCalled();
      expect(userRepo.createGoogleCustomer).not.toHaveBeenCalled();
      expect(loginUseCase.issueCustomerSession).toHaveBeenCalledWith(existing, {
        userAgent: 'jest-ua',
        ipAddress: '1.2.3.4',
      });
    });
  });

  describe('(c) no link, verified-email match → AUTO-LINK', () => {
    it('links the Google identity, activates, and mints a session for the relinked user (no create)', async () => {
      const byEmail = customer({ id: 'local-1' });
      const relinked = customer({ id: 'local-1', status: 'ACTIVE' });
      const verifier = buildVerifier({});
      const userRepo = buildUserRepo({
        findUserByAuthIdentity: jest.fn().mockResolvedValue(null),
        findByEmailWithRoles: jest.fn().mockResolvedValue(byEmail),
        linkGoogleIdentityAndActivate: jest.fn().mockResolvedValue(relinked),
      });
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      const result = await uc.execute(ctx);

      expect(result).toBe(SENTINEL_SESSION);
      expect(userRepo.linkGoogleIdentityAndActivate).toHaveBeenCalledWith({
        userId: 'local-1',
        providerSubject: 'google-sub',
        providerEmail: 'user@example.com',
      });
      expect(userRepo.createGoogleCustomer).not.toHaveBeenCalled();
      // Session is issued for the REFRESHED (relinked) user, not the stale one.
      expect(loginUseCase.issueCustomerSession).toHaveBeenCalledWith(
        relinked,
        expect.anything(),
      );
    });
  });

  describe('(d) brand-new customer → AUTO-CREATE', () => {
    it('calls createGoogleCustomer with the verified subject/email + consent rows, then mints a session', async () => {
      const created = customer({ id: 'new-1' });
      const verifier = buildVerifier({
        firstName: 'New',
        lastName: 'Person',
      });
      const userRepo = buildUserRepo({
        findUserByAuthIdentity: jest.fn().mockResolvedValue(null),
        findByEmailWithRoles: jest.fn().mockResolvedValue(null),
        createGoogleCustomer: jest.fn().mockResolvedValue(created),
      });
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      const result = await uc.execute(ctx);
      expect(result).toBe(SENTINEL_SESSION);

      expect(userRepo.createGoogleCustomer).toHaveBeenCalledTimes(1);
      const arg = userRepo.createGoogleCustomer.mock.calls[0][0];
      expect(arg).toMatchObject({
        firstName: 'New',
        lastName: 'Person',
        email: 'user@example.com',
        providerSubject: 'google-sub',
        providerEmail: 'user@example.com',
      });

      // The use case carries consent rows into the create. CUSTOMER role
      // and emailVerified=true are the repo's transactional guarantee
      // (documented on createGoogleCustomer + verified at the repo layer);
      // here we assert the use case supplies the consent evidence and that
      // the created user (CUSTOMER-roled) flows on to the session mint.
      const purposes = arg.consents.map((c: any) => c.purpose).sort();
      expect(purposes).toEqual([
        'EMAIL_MARKETING',
        'PRIVACY_POLICY',
        'TERMS_OF_SERVICE',
      ]);
      const byPurpose = Object.fromEntries(
        arg.consents.map((c: any) => [c.purpose, c]),
      );
      expect(byPurpose.TERMS_OF_SERVICE.granted).toBe(true);
      expect(byPurpose.PRIVACY_POLICY.granted).toBe(true);
      expect(byPurpose.EMAIL_MARKETING.granted).toBe(false); // opt-OUT default
      // Consent provenance is stamped so DPDP audit can trace the source.
      expect(byPurpose.TERMS_OF_SERVICE.source).toBe('google-oauth');
      expect(byPurpose.TERMS_OF_SERVICE.consentVersion).toBeTruthy();

      expect(loginUseCase.issueCustomerSession).toHaveBeenCalledWith(
        created,
        expect.anything(),
      );
      // The created user carries the CUSTOMER role per the repo contract.
      expect(created.roleAssignments[0]?.role.name).toBe('CUSTOMER');
    });

    it('falls back to a default first name when Google omits the given name', async () => {
      const created = customer({ id: 'new-2' });
      const verifier = buildVerifier({ firstName: '', lastName: '' });
      const userRepo = buildUserRepo({
        createGoogleCustomer: jest.fn().mockResolvedValue(created),
      });
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      await uc.execute(ctx);
      const arg = userRepo.createGoogleCustomer.mock.calls[0][0];
      expect(arg.firstName).toBe('Customer'); // NOT-NULL column satisfied
      expect(arg.lastName).toBe('');
    });

    it('P2002 race (create returns null) → recovers via the identity link and still mints a session', async () => {
      const recovered = customer({ id: 'raced-1' });
      const verifier = buildVerifier({});
      const findByAuth = jest
        .fn()
        .mockResolvedValueOnce(null) // first lookup: no link yet
        .mockResolvedValueOnce(recovered); // recovery after null create
      const userRepo = buildUserRepo({
        findUserByAuthIdentity: findByAuth,
        findByEmailWithRoles: jest.fn().mockResolvedValue(null),
        createGoogleCustomer: jest.fn().mockResolvedValue(null),
      });
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      const result = await uc.execute(ctx);
      expect(result).toBe(SENTINEL_SESSION);
      expect(loginUseCase.issueCustomerSession).toHaveBeenCalledWith(
        recovered,
        expect.anything(),
      );
    });
  });

  describe('(e) moderated account → uniform 401, no session', () => {
    it.each(['SUSPENDED', 'BANNED', 'INACTIVE'])(
      'returning Google user with status %s → 401, no session minted',
      async (status) => {
        const verifier = buildVerifier({});
        const userRepo = buildUserRepo({
          findUserByAuthIdentity: jest
            .fn()
            .mockResolvedValue(customer({ status })),
        });
        const loginUseCase = buildLoginUseCase();

        const uc = new GoogleLoginUseCase(
          userRepo,
          verifier,
          loginUseCase,
          noopLogger,
        );

        await expect(uc.execute(ctx)).rejects.toBeInstanceOf(
          UnauthorizedAppException,
        );
        expect(loginUseCase.issueCustomerSession).not.toHaveBeenCalled();
      },
    );

    it('email-matched account that is BANNED → 401 BEFORE linking (Google cannot override a ban)', async () => {
      const verifier = buildVerifier({});
      const userRepo = buildUserRepo({
        findUserByAuthIdentity: jest.fn().mockResolvedValue(null),
        findByEmailWithRoles: jest
          .fn()
          .mockResolvedValue(customer({ status: 'BANNED' })),
      });
      const loginUseCase = buildLoginUseCase();

      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        loginUseCase,
        noopLogger,
      );

      await expect(uc.execute(ctx)).rejects.toBeInstanceOf(
        UnauthorizedAppException,
      );
      expect(userRepo.linkGoogleIdentityAndActivate).not.toHaveBeenCalled();
      expect(loginUseCase.issueCustomerSession).not.toHaveBeenCalled();
    });

    it('moderated message does not leak the moderation state (uniform copy)', async () => {
      const verifier = buildVerifier({});
      const userRepo = buildUserRepo({
        findUserByAuthIdentity: jest
          .fn()
          .mockResolvedValue(customer({ status: 'SUSPENDED' })),
      });
      const uc = new GoogleLoginUseCase(
        userRepo,
        verifier,
        buildLoginUseCase(),
        noopLogger,
      );
      await expect(uc.execute(ctx)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Your account cannot be signed in at this time.',
      });
    });
  });
});
