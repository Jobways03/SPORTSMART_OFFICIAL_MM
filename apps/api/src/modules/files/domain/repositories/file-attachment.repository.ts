export interface FileAttachmentRepository { findByResourceId(resourceId: string): Promise<unknown[]>; save(attachment: unknown): Promise<void>; }
