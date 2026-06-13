import {
  computeSettlementCharges,
  type ChargeRuleForCompute,
} from './settlement-charge-calculator';

const D = (s: string) => new Date(s);

// PGS ₹10,000 = 1,000,000 paise; Commission ₹1,000 = 100,000 paise.
const PGS = 1_000_000n;
const COMM = 100_000n;

function rule(p: Partial<ChargeRuleForCompute>): ChargeRuleForCompute {
  return {
    id: p.id ?? 'r1',
    name: p.name ?? 'Rule',
    rateBps: p.rateBps ?? 0,
    baseType: p.baseType ?? 'COMMISSION',
    baseRuleId: p.baseRuleId ?? null,
    priority: p.priority ?? 0,
    createdAt: p.createdAt ?? D('2026-06-11T00:00:00Z'),
  };
}

describe('computeSettlementCharges', () => {
  it('computes a commission-based rule (GST 18% on commission)', () => {
    const { lines, totalInPaise } = computeSettlementCharges(
      [rule({ id: 'gst', name: 'GST', rateBps: 1800, baseType: 'COMMISSION' })],
      PGS,
      COMM,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.baseAmountInPaise).toBe(100_000n);
    expect(lines[0]!.amountInPaise).toBe(18_000n); // ₹180
    expect(totalInPaise).toBe(18_000n);
  });

  it('computes a PGS-based rule (2% of price of goods sold)', () => {
    const { lines } = computeSettlementCharges(
      [rule({ id: 'gov', rateBps: 200, baseType: 'PRICE_OF_GOODS_SOLD' })],
      PGS,
      COMM,
    );
    expect(lines[0]!.baseAmountInPaise).toBe(1_000_000n);
    expect(lines[0]!.amountInPaise).toBe(20_000n); // ₹200
  });

  it('levies a rule on another rule (TCS 1% of the GST amount), in order', () => {
    const { lines, totalInPaise } = computeSettlementCharges(
      [
        // intentionally out of order to prove priority/createdAt ordering
        rule({ id: 'tcs', name: 'TCS', rateBps: 100, baseType: 'RULE', baseRuleId: 'gst', priority: 2, createdAt: D('2026-06-11T02:00:00Z') }),
        rule({ id: 'gst', name: 'GST', rateBps: 1800, baseType: 'COMMISSION', priority: 1, createdAt: D('2026-06-11T01:00:00Z') }),
      ],
      PGS,
      COMM,
    );
    const gst = lines.find((l) => l.ruleId === 'gst')!;
    const tcs = lines.find((l) => l.ruleId === 'tcs')!;
    expect(gst.amountInPaise).toBe(18_000n); // ₹180
    expect(tcs.baseAmountInPaise).toBe(18_000n); // levied on the GST amount
    expect(tcs.amountInPaise).toBe(180n); // 1% of ₹180 = ₹1.80
    expect(totalInPaise).toBe(18_180n);
    // gst (priority 1) must be computed before tcs (priority 2)
    expect(lines[0]!.ruleId).toBe('gst');
  });

  it('rounds half-up to the nearest paise', () => {
    // 100,025 paise × 0.5% = 500.125 → 500 (below half); use a value that lands on .5
    const { lines } = computeSettlementCharges(
      [rule({ rateBps: 1, baseType: 'COMMISSION' })], // 0.01%
      PGS,
      15_000n, // 15000 × 1 / 10000 = 1.5 → rounds to 2
    );
    expect(lines[0]!.amountInPaise).toBe(2n);
  });

  it('treats a zero/negative base as zero and a forward rule-ref as zero', () => {
    const { lines, totalInPaise } = computeSettlementCharges(
      [rule({ id: 'x', rateBps: 1800, baseType: 'RULE', baseRuleId: 'missing' })],
      PGS,
      COMM,
    );
    expect(lines[0]!.amountInPaise).toBe(0n);
    expect(totalInPaise).toBe(0n);
  });
});
