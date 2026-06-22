/**
 * Cluster entrypoint — multi-core utilisation for a single pod/host.
 *
 * Node runs one JS thread per process, so a pod with a multi-core CPU limit
 * (api.deployment.yaml grants up to 1500m) leaves cores idle when a single
 * `node dist/main.js` runs. This wrapper forks N worker processes that share
 * the listen socket (the OS / Node cluster master load-balances accepted
 * connections across them), so one pod saturates its cores before k8s needs
 * to add another replica (HPA still scales pods on top of this).
 *
 * SAFETY — duplicate scheduled work:
 *   Crons are guarded by LeaderElectedCron (Redis leader election), so they
 *   fire on exactly ONE process cluster-wide regardless of how many workers
 *   or replicas exist. Adding workers never double-runs a settlement/recon
 *   job. SSE fan-out already bridges across processes via Redis pub/sub, and
 *   the rate-limit counters live in Redis (shared). The app is stateless, so
 *   any worker can serve any request.
 *
 * OPT-IN — defaults to single-process:
 *   CLUSTER_WORKERS unset or <= 1 → behaves exactly like `node dist/main.js`
 *   (no fork, lowest overhead). Set CLUSTER_WORKERS=0 to auto-size to the
 *   available CPU count, or a positive integer to pin the worker count.
 */
import cluster from 'node:cluster';
import * as os from 'node:os';

function desiredWorkers(): number {
  const raw = process.env.CLUSTER_WORKERS;
  // Unset → 1 (no clustering). Explicit 0 → all available cores.
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 1;
  if (n === 0) {
    const avail =
      (os as unknown as { availableParallelism?: () => number })
        .availableParallelism?.() ?? os.cpus().length;
    return Math.max(1, avail);
  }
  return Math.max(1, n);
}

const workers = desiredWorkers();

if (workers <= 1) {
  // Single-process path — identical to the legacy entrypoint.
  void import('./main');
} else if (cluster.isPrimary) {
  // eslint-disable-next-line no-console
  console.log(
    `[cluster] primary pid=${process.pid} forking ${workers} workers`,
  );
  let shuttingDown = false;

  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    // eslint-disable-next-line no-console
    console.error(
      `[cluster] worker pid=${worker.process.pid} exited (${
        signal || code
      }) — respawning`,
    );
    cluster.fork();
  });

  // Forward termination to workers so each runs its own graceful Nest
  // shutdown (SIGTERM handler in main.ts drains in-flight requests). k8s
  // sends SIGTERM to the primary; we fan it out.
  const stop = (sig: NodeJS.Signals) => {
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[cluster] ${sig} received — stopping workers`);
    for (const w of Object.values(cluster.workers ?? {})) w?.kill(sig);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
} else {
  // Worker process — boot the Nest application.
  void import('./main');
}
