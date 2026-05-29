import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FranchiseAddStaffDto } from '../../src/modules/franchise/presentation/dtos/franchise-add-staff.dto';
import { FranchiseStaffActivateDto } from '../../src/modules/franchise/presentation/dtos/franchise-staff-activate.dto';

/**
 * Phase 159u — add-staff DTO no longer carries a password (B4 invite flow);
 * password complexity (audit #10) moved to the activation DTO.
 */
describe('FranchiseAddStaffDto', () => {
  it('accepts an invite (name + email + role, no password)', async () => {
    const errs = await validate(
      plainToInstance(FranchiseAddStaffDto, { name: 'Asha', email: 'asha@shop.in', role: 'POS_OPERATOR' }),
    );
    expect(errs.length).toBe(0);
  });

  it('rejects an invalid role (OWNER is not a staff role)', async () => {
    const errs = await validate(
      plainToInstance(FranchiseAddStaffDto, { name: 'Asha', email: 'asha@shop.in', role: 'OWNER' }),
    );
    expect(errs.some((e) => e.property === 'role')).toBe(true);
  });
});

describe('FranchiseStaffActivateDto password complexity (#10)', () => {
  const pwErr = (errs: any[]) => errs.some((e) => e.property === 'password');

  it('rejects a length-only weak password', async () => {
    const errs = await validate(plainToInstance(FranchiseStaffActivateDto, { token: 't', password: '12345678' }));
    expect(pwErr(errs)).toBe(true);
  });

  it('rejects missing uppercase', async () => {
    const errs = await validate(plainToInstance(FranchiseStaffActivateDto, { token: 't', password: 'str0ngpass' }));
    expect(pwErr(errs)).toBe(true);
  });

  it('accepts a complex password', async () => {
    const errs = await validate(plainToInstance(FranchiseStaffActivateDto, { token: 't', password: 'Str0ngPass' }));
    expect(pwErr(errs)).toBe(false);
  });
});
