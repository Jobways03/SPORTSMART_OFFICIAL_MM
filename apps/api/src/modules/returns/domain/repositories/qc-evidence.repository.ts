export interface QcEvidenceRepository { findByReturnId(returnId: string): Promise<unknown[]>; save(evidence: unknown): Promise<void>; }
