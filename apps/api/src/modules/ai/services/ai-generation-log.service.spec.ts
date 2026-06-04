// Phase 249 — AiGenerationLog lifecycle: GENERATED write returns an id;
// markOutcome is a CAS (only the owner, only from GENERATED).
import { AiGenerationLogService } from './ai-generation-log.service';

function makeService() {
  const prisma: any = {
    aiGenerationLog: {
      create: jest.fn(async ({ data }: any) => ({ id: 'log1', ...data })),
      updateMany: jest.fn(),
    },
  };
  return { svc: new AiGenerationLogService(prisma), prisma };
}

describe('AiGenerationLogService', () => {
  it('recordGenerated returns the new log id', async () => {
    const { svc } = makeService();
    const id = await svc.recordGenerated({
      subject: 's1',
      subjectType: 'SELLER',
      promptVersion: 'product-content-v2',
      provider: 'gemini',
      generatedJson: { description: 'x' },
    });
    expect(id).toBe('log1');
  });

  it('recordGenerated swallows DB failure (best-effort → null)', async () => {
    const { svc, prisma } = makeService();
    prisma.aiGenerationLog.create.mockRejectedValueOnce(new Error('db down'));
    const id = await svc.recordGenerated({ subject: 's1', promptVersion: 'v2' });
    expect(id).toBeNull();
  });

  it('markOutcome CAS-updates only the owner + GENERATED row', async () => {
    const { svc, prisma } = makeService();
    prisma.aiGenerationLog.updateMany.mockResolvedValue({ count: 1 });
    const ok = await svc.markOutcome('log1', 's1', 'DISCARDED');
    expect(ok).toBe(true);
    expect(prisma.aiGenerationLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log1', subject: 's1', status: 'GENERATED' },
      data: expect.objectContaining({ status: 'DISCARDED' }),
    });
  });

  it('markOutcome returns false when nothing matched (not owner / already resolved)', async () => {
    const { svc, prisma } = makeService();
    prisma.aiGenerationLog.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.markOutcome('log1', 'intruder', 'ACCEPTED')).toBe(false);
  });
});
