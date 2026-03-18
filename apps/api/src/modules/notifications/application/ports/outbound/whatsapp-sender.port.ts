export interface WhatsappSenderPort { send(phone: string, templateId: string, variables: Record<string, unknown>): Promise<void>; }
