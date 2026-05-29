import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitFranchiseOnboardingDto } from '../../src/modules/franchise/presentation/dtos/submit-franchise-onboarding.dto';
import { FranchiseUpdateProfileDto } from '../../src/modules/franchise/presentation/dtos/franchise-update-profile.dto';
import { AdminEditFranchiseProfileDto } from '../../src/modules/franchise/presentation/dtos/admin-edit-franchise-profile.dto';
import { AdminUpdateFranchiseVerificationDto } from '../../src/modules/franchise/presentation/dtos/admin-update-franchise-verification.dto';

/**
 * Phase 159j — franchise KYC identifier + verification-status DTO validation.
 * Runtime evidence for audit #1 (verification enum aligned to Prisma),
 * #12 (PAN 4th-char holder-type code), #13 (GSTIN Mod-36 checksum).
 */

const VALID_GSTIN = '27AAACR4849R1ZL'; // checksum-valid (tax-domain reference)
const BAD_CHECKSUM_GSTIN = '27AAACR4849R1ZX'; // structurally valid, wrong check char
const VALID_PAN = 'AAACR4849R'; // 4th char 'C' (Company) — valid holder type
const BAD_4TH_CHAR_PAN = 'ABCDE1234F'; // 4th char 'D' is not a holder-type code

const errsFor = async (dto: object, prop: string) =>
  (await validate(dto)).filter((e) => e.property === prop);

describe('Franchise KYC DTO validation (Phase 159j)', () => {
  describe('SubmitFranchiseOnboardingDto', () => {
    const base = {
      legalBusinessName: 'Acme Sports Pvt Ltd',
      gstRegistrationType: 'REGULAR',
      gstStateCode: '27',
      businessAddress: {
        line1: '1 Main',
        city: 'Pune',
        state: 'MH',
        pincode: '411001',
        country: 'India',
      },
      confirmedAccurate: true,
    };

    it('accepts a checksum-valid GSTIN + holder-type-valid PAN', async () => {
      const dto = plainToInstance(SubmitFranchiseOnboardingDto, {
        ...base,
        gstNumber: VALID_GSTIN,
        panNumber: VALID_PAN,
      });
      expect(await errsFor(dto, 'gstNumber')).toHaveLength(0);
      expect(await errsFor(dto, 'panNumber')).toHaveLength(0);
    });

    it('rejects a GSTIN with a bad checksum (#13)', async () => {
      const dto = plainToInstance(SubmitFranchiseOnboardingDto, {
        ...base,
        gstNumber: BAD_CHECKSUM_GSTIN,
        panNumber: VALID_PAN,
      });
      expect((await errsFor(dto, 'gstNumber')).length).toBeGreaterThan(0);
    });

    it('rejects a PAN with an invalid 4th (holder-type) char (#12)', async () => {
      const dto = plainToInstance(SubmitFranchiseOnboardingDto, {
        ...base,
        gstNumber: VALID_GSTIN,
        panNumber: BAD_4TH_CHAR_PAN,
      });
      expect((await errsFor(dto, 'panNumber')).length).toBeGreaterThan(0);
    });
  });

  describe('FranchiseUpdateProfileDto', () => {
    it('accepts valid PAN/GST', async () => {
      const dto = plainToInstance(FranchiseUpdateProfileDto, {
        gstNumber: VALID_GSTIN,
        panNumber: VALID_PAN,
      });
      expect(await errsFor(dto, 'gstNumber')).toHaveLength(0);
      expect(await errsFor(dto, 'panNumber')).toHaveLength(0);
    });

    it('rejects bad-checksum GSTIN + bad-4th-char PAN', async () => {
      const dto = plainToInstance(FranchiseUpdateProfileDto, {
        gstNumber: BAD_CHECKSUM_GSTIN,
        panNumber: BAD_4TH_CHAR_PAN,
      });
      expect((await errsFor(dto, 'gstNumber')).length).toBeGreaterThan(0);
      expect((await errsFor(dto, 'panNumber')).length).toBeGreaterThan(0);
    });
  });

  describe('AdminEditFranchiseProfileDto (previously had NO PAN/GST format check)', () => {
    it('now rejects bad-checksum GSTIN + bad-4th-char PAN', async () => {
      const dto = plainToInstance(AdminEditFranchiseProfileDto, {
        gstNumber: BAD_CHECKSUM_GSTIN,
        panNumber: BAD_4TH_CHAR_PAN,
      });
      expect((await errsFor(dto, 'gstNumber')).length).toBeGreaterThan(0);
      expect((await errsFor(dto, 'panNumber')).length).toBeGreaterThan(0);
    });
  });

  describe('AdminUpdateFranchiseVerificationDto (#1 — enum aligned to Prisma)', () => {
    it('accepts NOT_VERIFIED (was wrongly rejected before)', async () => {
      const dto = plainToInstance(AdminUpdateFranchiseVerificationDto, {
        verificationStatus: 'NOT_VERIFIED',
      });
      expect(await errsFor(dto, 'verificationStatus')).toHaveLength(0);
    });

    it('rejects PENDING (not a FranchiseVerificationStatus member)', async () => {
      const dto = plainToInstance(AdminUpdateFranchiseVerificationDto, {
        verificationStatus: 'PENDING',
      });
      expect((await errsFor(dto, 'verificationStatus')).length).toBeGreaterThan(0);
    });
  });
});
