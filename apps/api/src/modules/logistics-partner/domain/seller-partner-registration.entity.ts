import type { RegistrationStatus } from '../../../integrations/logistics-facade/logistics-facade.constants';

/**
 * Domain entity for the SellerPartnerRegistration aggregate. Mirrors
 * the Prisma model field-for-field but stays decoupled from the
 * generated client so the module is testable without a DB seam.
 *
 * Mutations flow through the repository (PrismaSellerPartnerRegistration-
 * Repository). Domain logic that depends on the entity (e.g. "is this
 * registration in a state where we should call the partner again?")
 * lives in the application services that load the entity.
 */
export class SellerPartnerRegistrationEntity {
  constructor(
    public readonly id: string,
    public readonly sellerId: string,
    public readonly partner: string,
    public warehouseName: string | null,
    public status: RegistrationStatus,
    public lastError: string | null,
    public registeredAt: Date | null,
    public registeredBy: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  /** True if this registration represents a usable partner mapping. */
  isRegistered(): boolean {
    return this.status === 'REGISTERED' && !!this.warehouseName;
  }

  /** True if a re-register call should be allowed. */
  canRetry(): boolean {
    return (
      this.status === 'PENDING' ||
      this.status === 'FAILED' ||
      this.status === 'REGISTERED'
    );
  }
}
