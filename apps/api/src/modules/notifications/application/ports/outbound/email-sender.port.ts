export interface EmailSenderPort { send(to: string, subject: string, body: string): Promise<void>; }
