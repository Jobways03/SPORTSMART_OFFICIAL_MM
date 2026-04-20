/**
 * Guard for destructive DB scripts (migrate reset, db:fresh).
 *
 * Refuses to run when NODE_ENV is production. The intent is to catch
 * the realistic mistake of someone running `pnpm db:reset` in a
 * terminal still pointing at prod — migrate reset --force will happily
 * drop the whole database without another prompt, and we've had
 * near-misses where `.env` leaked the prod DATABASE_URL into a local
 * shell. This is a last-line check; the first line of defence is
 * never giving a dev machine prod credentials.
 */

export function guardNotProd(nodeEnv: string | undefined = process.env.NODE_ENV): void {
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to run destructive DB script with NODE_ENV=production. ' +
        'If you truly mean to reset a production database, unset NODE_ENV first and run the underlying prisma command by hand.',
    );
  }
}

// Allow direct invocation: `ts-node prisma/scripts/guard-not-prod.ts`.
// Exits 1 on failure so a package.json `&&` chain short-circuits.
const isMain =
  typeof require !== 'undefined' && require.main === module;
if (isMain) {
  try {
    guardNotProd();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
