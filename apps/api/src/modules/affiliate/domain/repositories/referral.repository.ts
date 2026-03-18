export interface ReferralRepository { findByCode(code: string): Promise<unknown | null>; save(referral: unknown): Promise<void>; }
