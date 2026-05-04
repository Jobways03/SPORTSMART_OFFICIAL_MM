import { Injectable } from '@nestjs/common';
import type { TicketPriority } from '@prisma/client';
import { SupportService } from '../services/support.service';

/**
 * Cross-module entry point. Other modules (e.g. returns dispute escalation,
 * payment mismatch alerts) use this to file system-generated tickets that
 * surface in the admin queue without needing a logged-in actor.
 */
@Injectable()
export class SupportPublicFacade {
  constructor(private readonly support: SupportService) {}

  /**
   * File a system-generated ticket on behalf of a customer / seller / etc.
   * Used by other modules to surface issues that warrant admin attention
   * (refund stuck, dispute escalated, payment reconciliation mismatch, …).
   */
  createSystemTicket(args: {
    onBehalfOf: {
      type: 'CUSTOMER' | 'SELLER' | 'FRANCHISE' | 'AFFILIATE';
      id: string;
      name: string;
      email: string;
    };
    subject: string;
    body: string;
    priority?: TicketPriority;
    categoryId?: string;
    relatedOrderId?: string;
    relatedReturnId?: string;
  }) {
    return this.support.createTicket({
      creator: args.onBehalfOf,
      subject: args.subject,
      body: args.body,
      priority: args.priority ?? 'HIGH',
      categoryId: args.categoryId,
      relatedOrderId: args.relatedOrderId,
      relatedReturnId: args.relatedReturnId,
    });
  }
}
