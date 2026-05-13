import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 4 (PR 4.4) — `sub_orders.last_tracking_event_at` schema guard.
 *
 * The ordering-guard logic in TrackingWebhookController + the
 * `claimTrackingEvent` CAS in OrdersPublicFacade depend on this
 * column existing on the DB and the Prisma model. Drift between
 * any of the three artefacts (schema, migration, claim predicate)
 * silently turns the ordering check into a no-op.
 */

const SCHEMA_BASE = join(__dirname, '..', '..', 'prisma', 'schema');

describe('sub_orders.lastTrackingEventAt invariant (PR 4.4)', () => {
  it('Prisma model declares the lastTrackingEventAt column on SubOrder', () => {
    const source = readFileSync(join(SCHEMA_BASE, 'orders.prisma'), 'utf8');
    expect(source).toMatch(
      /lastTrackingEventAt\s+DateTime\?\s+@map\("last_tracking_event_at"\)/,
    );
  });

  it('migration SQL adds the column as nullable TIMESTAMP', () => {
    const sql = readFileSync(
      join(
        SCHEMA_BASE,
        'migrations',
        '20260512190000_sub_order_last_tracking_event',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+"sub_orders"[\s\S]*ADD\s+COLUMN\s+"last_tracking_event_at"\s+TIMESTAMP/i,
    );
    expect(sql).not.toMatch(/last_tracking_event_at.*NOT NULL/i);
  });

  it('OrdersPublicFacade.claimTrackingEvent uses the CAS predicate matching the column', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src',
        'modules',
        'orders',
        'application',
        'facades',
        'orders-public.facade.ts',
      ),
      'utf8',
    );
    // The CAS guard: only update when stored value is NULL or strictly older.
    expect(source).toMatch(/claimTrackingEvent\s*\(/);
    expect(source).toMatch(/lastTrackingEventAt:\s*null/);
    expect(source).toMatch(/lastTrackingEventAt:\s*\{\s*lt:\s*eventTimestamp\s*\}/);
    expect(source).toMatch(/result\.count\s*===\s*1/);
  });

  it('TrackingWebhookController calls claimTrackingEvent BEFORE markSubOrderDelivered', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src',
        'modules',
        'shipping',
        'presentation',
        'controllers',
        'tracking-webhook.controller.ts',
      ),
      'utf8',
    );
    const claimIdx = source.indexOf('claimTrackingEvent');
    const markIdx = source.indexOf('markSubOrderDelivered(subOrder.id)');
    expect(claimIdx).toBeGreaterThan(0);
    expect(markIdx).toBeGreaterThan(0);
    expect(claimIdx).toBeLessThan(markIdx);
  });
});
