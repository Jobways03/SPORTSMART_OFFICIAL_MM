// Dynamic settlement charge calculator (Phase 251) — pure, no I/O.
//
// Given the active charge rules and the two fixed bases (Price of Goods Sold
// and Commission, in paise), compute each rule's amount and the total. A rule
// is `rateBps` of its base, where the base is PRICE_OF_GOODS_SOLD, COMMISSION,
// or another rule (RULE → the amount that other rule already computed for THIS
// settlement). Rules run in priority order (then creation order), so a rule
// levied on another rule sees the earlier rule's amount.

export interface ChargeRuleForCompute {
  id: string;
  name: string;
  rateBps: number;
  /** PRICE_OF_GOODS_SOLD | COMMISSION | RULE */
  baseType: string;
  baseRuleId: string | null;
  priority: number;
  createdAt: Date;
}

export interface ComputedChargeLine {
  ruleId: string;
  ruleName: string;
  baseType: string;
  baseRuleId: string | null;
  baseAmountInPaise: bigint;
  rateBps: number;
  amountInPaise: bigint;
  priority: number;
}

/** amount = base × bps / 10000, rounded half-up (matches the TCS/TDS hooks). */
function mulBpsHalfUp(value: bigint, bps: number): bigint {
  if (bps <= 0 || value <= 0n) return 0n;
  return (value * BigInt(bps) + 5000n) / 10000n;
}

export function computeSettlementCharges(
  rules: ChargeRuleForCompute[],
  pgsInPaise: bigint,
  commissionInPaise: bigint,
): { lines: ComputedChargeLine[]; totalInPaise: bigint } {
  const sorted = [...rules].sort(
    (a, b) =>
      a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const computed = new Map<string, bigint>();
  const lines: ComputedChargeLine[] = [];

  for (const r of sorted) {
    let base: bigint;
    if (r.baseType === 'PRICE_OF_GOODS_SOLD') {
      base = pgsInPaise;
    } else if (r.baseType === 'COMMISSION') {
      base = commissionInPaise;
    } else {
      // RULE — the amount the referenced rule computed earlier (0 if it hasn't
      // run yet, e.g. a forward reference that priority order didn't satisfy).
      base = r.baseRuleId ? (computed.get(r.baseRuleId) ?? 0n) : 0n;
    }
    if (base < 0n) base = 0n;

    const amountInPaise = mulBpsHalfUp(base, r.rateBps);
    computed.set(r.id, amountInPaise);
    lines.push({
      ruleId: r.id,
      ruleName: r.name,
      baseType: r.baseType,
      baseRuleId: r.baseRuleId ?? null,
      baseAmountInPaise: base,
      rateBps: r.rateBps,
      amountInPaise,
      priority: r.priority,
    });
  }

  const totalInPaise = lines.reduce((s, l) => s + l.amountInPaise, 0n);
  return { lines, totalInPaise };
}
