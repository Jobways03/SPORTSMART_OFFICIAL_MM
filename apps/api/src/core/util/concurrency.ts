// Phase 101 (2026-05-23) — Phase 104 audit Gap #4 closure.
//
// Lightweight bounded-concurrency helper for fan-out work where
// `Promise.all(...)` would spike the DB. We don't want a runtime dep
// on p-limit for a 20-line utility; this hand-rolled version covers
// the bulk endpoints' needs (preserve order of outputs, return all
// results including errors).

export async function runWithConcurrency<TIn, TOut>(
  items: ReadonlyArray<TIn>,
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (concurrency <= 0) throw new Error('concurrency must be > 0');
  if (items.length === 0) return [];

  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  async function spawn(): Promise<void> {
    while (true) {
      const i = nextIndex;
      if (i >= items.length) return;
      nextIndex = i + 1;
      results[i] = await worker(items[i] as TIn, i);
    }
  }

  const workers: Promise<void>[] = [];
  const lanes = Math.min(concurrency, items.length);
  for (let k = 0; k < lanes; k += 1) workers.push(spawn());
  await Promise.all(workers);
  return results;
}
