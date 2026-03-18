export interface FileMetadataRepository { findById(id: string): Promise<unknown | null>; save(metadata: unknown): Promise<void>; }
