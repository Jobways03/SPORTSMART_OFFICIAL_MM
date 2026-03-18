export interface NotificationLogRepository { save(log: unknown): Promise<void>; findByRecipientId(recipientId: string): Promise<unknown[]>; }
