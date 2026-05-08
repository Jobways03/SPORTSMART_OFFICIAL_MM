import { PrismaClient } from '@prisma/client';

/**
 * Phase 6 (PR 6.5) — Seed example SLA policies.
 *
 * Idempotent: each upsert keys on (resourceType, status, name) so
 * re-runs are safe. Production teams should review and adjust the
 * deadlines to match their SLAs before flipping
 * SLA_BREACH_DETECTOR_ENABLED=true.
 *
 * Defaults below capture the most common e-commerce ops cadence:
 *   - Disputes: first-touch within 24h, resolution within 7d.
 *   - Returns:  approval within 4h after request.
 *   - Tickets:  reply within 24h after last buyer message.
 */

const POLICIES = [
  // ── Disputes ──────────────────────────────────────────────────
  {
    name: 'dispute-first-touch',
    description:
      'OPEN disputes must be picked up by an admin within 24 hours.',
    resourceType: 'dispute',
    status: 'OPEN',
    deadlineMinutes: 60 * 24,
    warningMinutesBeforeDeadline: 60 * 4,
    escalateAfterMinutes: 60 * 12, // escalate 12h overdue
    escalateAction: 'BOOST_SEVERITY',
  },
  {
    name: 'dispute-resolution',
    description: 'UNDER_REVIEW disputes must resolve within 7 days.',
    resourceType: 'dispute',
    status: 'UNDER_REVIEW',
    deadlineMinutes: 60 * 24 * 7,
    warningMinutesBeforeDeadline: 60 * 24,
    escalateAfterMinutes: 60 * 24, // escalate 1d overdue
    escalateAction: 'REASSIGN_SENIOR',
  },
  {
    name: 'dispute-awaiting-info',
    description:
      'AWAITING_INFO disputes must move within 14 days (or close as procedural).',
    resourceType: 'dispute',
    status: 'AWAITING_INFO',
    deadlineMinutes: 60 * 24 * 14,
    warningMinutesBeforeDeadline: 60 * 24 * 2,
    escalateAfterMinutes: 60 * 24 * 3,
    escalateAction: 'NOTIFY_MANAGER',
  },

  // ── Returns ──────────────────────────────────────────────────
  {
    name: 'return-approval',
    description: 'REQUESTED returns must be approved/rejected within 4h.',
    resourceType: 'return',
    status: 'REQUESTED',
    deadlineMinutes: 240,
    warningMinutesBeforeDeadline: 60,
    escalateAfterMinutes: 240, // escalate 4h overdue
    escalateAction: 'NOTIFY_MANAGER',
  },
  {
    name: 'return-receive-to-qc',
    description:
      'RECEIVED returns must complete QC within 48h (warehouse SLA).',
    resourceType: 'return',
    status: 'RECEIVED',
    deadlineMinutes: 60 * 48,
    warningMinutesBeforeDeadline: 60 * 8,
    escalateAfterMinutes: 60 * 24,
    escalateAction: 'NOTIFY_MANAGER',
  },

  // ── Tickets ──────────────────────────────────────────────────
  {
    name: 'ticket-first-reply',
    description:
      'OPEN tickets must receive an admin reply within 24h of last buyer message.',
    resourceType: 'ticket',
    status: 'OPEN',
    deadlineMinutes: 60 * 24,
    warningMinutesBeforeDeadline: 60 * 4,
    escalateAfterMinutes: 60 * 12,
    escalateAction: 'REASSIGN_SENIOR',
  },
];

export async function seedSlaPolicies(prisma: PrismaClient): Promise<void> {
  for (const p of POLICIES) {
    // Build a where clause matching the @@unique([resourceType, status, name])
    // composite key so re-runs find the existing row instead of inserting.
    const existing = await prisma.slaPolicy.findFirst({
      where: {
        resourceType: p.resourceType,
        status: p.status,
        name: p.name,
      },
    });
    if (existing) {
      await prisma.slaPolicy.update({
        where: { id: existing.id },
        data: {
          description: p.description,
          deadlineMinutes: p.deadlineMinutes,
          warningMinutesBeforeDeadline: p.warningMinutesBeforeDeadline,
          escalateAfterMinutes: p.escalateAfterMinutes,
          escalateAction: p.escalateAction,
        },
      });
    } else {
      await prisma.slaPolicy.create({
        data: {
          name: p.name,
          description: p.description,
          resourceType: p.resourceType,
          status: p.status,
          deadlineMinutes: p.deadlineMinutes,
          warningMinutesBeforeDeadline: p.warningMinutesBeforeDeadline,
          escalateAfterMinutes: p.escalateAfterMinutes,
          escalateAction: p.escalateAction,
          enabled: true,
        },
      });
    }
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedSlaPolicies(prisma)
    .then(() => {
      console.log(`Seeded ${POLICIES.length} SLA policies.`);
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Failed to seed SLA policies:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
