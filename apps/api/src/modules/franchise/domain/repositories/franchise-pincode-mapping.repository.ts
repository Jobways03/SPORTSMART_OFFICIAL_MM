export interface FranchisePincodeMappingRepository { findByPincode(pincode: string): Promise<unknown | null>; save(mapping: unknown): Promise<void>; }
