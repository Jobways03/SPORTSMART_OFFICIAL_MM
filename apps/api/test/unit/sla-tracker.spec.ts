import 'reflect-metadata';
import { SlaTrackerService } from '../../src/core/sla/sla-tracker.service';

/**
 * Phase 6 (PR 6.1) — SlaTrackerService.
 *
 * Pin every state branch:
 *   - OK: well within deadline.
 *   - WARNING: inside the warn-band (only when warningMinutesBeforeDeadline set).
 *   - BREACHED: past deadline, no escalate config.
 *   - BREACHED_ESCALATE: past deadline + past escalate-after.
 *
 * Plus: cache invalidation, snapshot with no matching policy returns nothing,
 * and remainingMinutes is correctly negative when overdue.
 */
describe('SlaTrackerService', () => {
  function setup(policies: any[]) {
    const fakePrisma: any = {
      slaPolicy: {
        findMany: jest.fn(async ({ where }) =>
          policies.filter((p) => (where?.enabled ? p.enabled : true)),
        ),
      },
    };
    return {
      svc: new SlaTrackerService(fakePrisma),
      fakePrisma,
    };
  }

  const baseTime = new Date('2026-05-05T12:00:00Z');

  it('returns no verdicts when no policy matches', async () => {
    const { svc } = setup([]);
    const verdicts = await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd1',
          status: 'UNDER_REVIEW',
          enteredStatusAt: baseTime,
        },
      ],
      baseTime,
    );
    expect(verdicts).toEqual([]);
  });

  it('returns OK when well within deadline', async () => {
    const { svc } = setup([
      {
        id: 'p1',
        name: 'dispute-resolution',
        resourceType: 'dispute',
        status: 'UNDER_REVIEW',
        deadlineMinutes: 60 * 24 * 7, // 7 days
        warningMinutesBeforeDeadline: 60 * 24, // 1 day before
        escalateAfterMinutes: 60 * 24, // 1 day past
        escalateAction: 'REASSIGN_SENIOR',
        enabled: true,
      },
    ]);
    const verdicts = await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd1',
          status: 'UNDER_REVIEW',
          enteredStatusAt: baseTime,
        },
      ],
      new Date(baseTime.getTime() + 60 * 60_000), // 1h in
    );
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].state).toBe('OK');
    expect(verdicts[0].remainingMinutes).toBe(60 * 24 * 7 - 60);
  });

  it('returns WARNING inside the warn-band', async () => {
    const { svc } = setup([
      {
        id: 'p1',
        name: 'p',
        resourceType: 'dispute',
        status: 'UNDER_REVIEW',
        deadlineMinutes: 600,
        warningMinutesBeforeDeadline: 60,
        escalateAfterMinutes: null,
        escalateAction: null,
        enabled: true,
      },
    ]);
    const verdicts = await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd1',
          status: 'UNDER_REVIEW',
          enteredStatusAt: baseTime,
        },
      ],
      new Date(baseTime.getTime() + 550 * 60_000), // 50min remaining
    );
    expect(verdicts[0].state).toBe('WARNING');
  });

  it('returns BREACHED when past the deadline but before escalate-after', async () => {
    const { svc } = setup([
      {
        id: 'p1',
        name: 'p',
        resourceType: 'return',
        status: 'REQUESTED',
        deadlineMinutes: 240,
        warningMinutesBeforeDeadline: null,
        escalateAfterMinutes: 240, // escalate after another 4h overdue
        escalateAction: 'REASSIGN_SENIOR',
        enabled: true,
      },
    ]);
    const verdicts = await svc.evaluate(
      [
        {
          resourceType: 'return',
          resourceId: 'r1',
          status: 'REQUESTED',
          enteredStatusAt: baseTime,
        },
      ],
      new Date(baseTime.getTime() + 300 * 60_000), // 1h overdue
    );
    expect(verdicts[0].state).toBe('BREACHED');
    expect(verdicts[0].remainingMinutes).toBe(-60);
  });

  it('returns BREACHED_ESCALATE when past escalate-after', async () => {
    const { svc } = setup([
      {
        id: 'p1',
        name: 'p',
        resourceType: 'return',
        status: 'REQUESTED',
        deadlineMinutes: 240,
        warningMinutesBeforeDeadline: null,
        escalateAfterMinutes: 240,
        escalateAction: 'REASSIGN_SENIOR',
        enabled: true,
      },
    ]);
    const verdicts = await svc.evaluate(
      [
        {
          resourceType: 'return',
          resourceId: 'r1',
          status: 'REQUESTED',
          enteredStatusAt: baseTime,
        },
      ],
      new Date(baseTime.getTime() + 600 * 60_000), // 6h overdue, > 4h escalate window
    );
    expect(verdicts[0].state).toBe('BREACHED_ESCALATE');
    expect(verdicts[0].escalateAction).toBe('REASSIGN_SENIOR');
  });

  it('skips disabled policies', async () => {
    const { svc } = setup([
      {
        id: 'p1',
        name: 'p',
        resourceType: 'dispute',
        status: 'UNDER_REVIEW',
        deadlineMinutes: 60,
        warningMinutesBeforeDeadline: null,
        escalateAfterMinutes: null,
        escalateAction: null,
        enabled: false,
      },
    ]);
    const verdicts = await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd1',
          status: 'UNDER_REVIEW',
          enteredStatusAt: baseTime,
        },
      ],
      new Date(baseTime.getTime() + 600 * 60_000),
    );
    expect(verdicts).toEqual([]);
  });

  it('caches policy reads — second call hits cache', async () => {
    const { svc, fakePrisma } = setup([]);
    await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd1',
          status: 'OPEN',
          enteredStatusAt: baseTime,
        },
      ],
      baseTime,
    );
    await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd2',
          status: 'OPEN',
          enteredStatusAt: baseTime,
        },
      ],
      baseTime,
    );
    expect((fakePrisma.slaPolicy.findMany as any).mock.calls.length).toBe(1);
    svc.invalidate();
    await svc.evaluate(
      [
        {
          resourceType: 'dispute',
          resourceId: 'd3',
          status: 'OPEN',
          enteredStatusAt: baseTime,
        },
      ],
      baseTime,
    );
    expect((fakePrisma.slaPolicy.findMany as any).mock.calls.length).toBe(2);
  });

  it('evaluateOne returns the most-urgent verdict when multiple policies fire', async () => {
    const { svc } = setup([
      {
        id: 'p1',
        name: 'lenient',
        resourceType: 'dispute',
        status: 'OPEN',
        deadlineMinutes: 60 * 24 * 7,
        warningMinutesBeforeDeadline: null,
        escalateAfterMinutes: null,
        escalateAction: null,
        enabled: true,
      },
      {
        id: 'p2',
        name: 'strict',
        resourceType: 'dispute',
        status: 'OPEN',
        deadlineMinutes: 60,
        warningMinutesBeforeDeadline: null,
        escalateAfterMinutes: null,
        escalateAction: null,
        enabled: true,
      },
    ]);
    const v = await svc.evaluateOne(
      {
        resourceType: 'dispute',
        resourceId: 'd1',
        status: 'OPEN',
        enteredStatusAt: baseTime,
      },
      new Date(baseTime.getTime() + 30 * 60_000),
    );
    expect(v?.policyName).toBe('strict');
  });
});
