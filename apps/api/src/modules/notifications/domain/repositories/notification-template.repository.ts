export interface NotificationTemplateRepository { findByKey(key: string): Promise<unknown | null>; }
