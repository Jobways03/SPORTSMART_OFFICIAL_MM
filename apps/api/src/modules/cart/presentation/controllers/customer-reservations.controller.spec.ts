/**
 * Phase 52 polish (2026-05-21) — customer-facing reservation
 * endpoints. Pins the ownership-check contract so a customer cannot
 * inspect or extend another customer's reservation.
 */

import { StockReservationStatus } from '@prisma/client';
import {
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { CustomerReservationsController } from './customer-reservations.controller';

function makeController(over: {
  getReservation?: jest.Mock;
  extendReservation?: jest.Mock;
} = {}) {
  const inventory = {
    getReservation: over.getReservation ?? jest.fn(),
    extendReservation: over.extendReservation ?? jest.fn(),
  } as any;
  return new CustomerReservationsController(inventory);
}

function req(userId = 'customer-1') {
  return { userId };
}

describe('CustomerReservationsController.getReservation (Phase 52 polish)', () => {
  it('throws NotFound when the reservation does not exist', async () => {
    const ctrl = makeController({ getReservation: jest.fn().mockResolvedValue(null) });

    await expect(ctrl.getReservation(req(), 'r-ghost')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('throws Forbidden when the reservation belongs to another customer', async () => {
    const ctrl = makeController({
      getReservation: jest.fn().mockResolvedValue({
        id: 'r-1',
        status: StockReservationStatus.RESERVED,
        quantity: 2,
        expiresAt: new Date(),
        secondsRemaining: 120,
        customerId: 'OTHER',
      }),
    });

    await expect(ctrl.getReservation(req(), 'r-1')).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('throws Forbidden when the reservation has no customerId (guest)', async () => {
    const ctrl = makeController({
      getReservation: jest.fn().mockResolvedValue({
        id: 'r-1',
        status: StockReservationStatus.RESERVED,
        quantity: 2,
        expiresAt: new Date(),
        secondsRemaining: 120,
        customerId: null,
      }),
    });

    await expect(ctrl.getReservation(req(), 'r-1')).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('returns the reservation when the caller owns it', async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    const ctrl = makeController({
      getReservation: jest.fn().mockResolvedValue({
        id: 'r-1',
        status: StockReservationStatus.RESERVED,
        quantity: 2,
        expiresAt,
        secondsRemaining: 120,
        customerId: 'customer-1',
      }),
    });

    const out = await ctrl.getReservation(req(), 'r-1');
    expect(out.success).toBe(true);
    expect(out.data).toEqual({
      id: 'r-1',
      status: 'RESERVED',
      quantity: 2,
      expiresAt,
      secondsRemaining: 120,
    });
  });
});

describe('CustomerReservationsController.extend (Phase 52 polish)', () => {
  it('throws NotFound when the reservation does not exist', async () => {
    const ctrl = makeController({ getReservation: jest.fn().mockResolvedValue(null) });

    await expect(
      ctrl.extend(req(), 'r-1', { extraMinutes: 5 } as any),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws Forbidden before extending if the caller is not the owner', async () => {
    const extendReservation = jest.fn();
    const ctrl = makeController({
      getReservation: jest.fn().mockResolvedValue({
        id: 'r-1',
        status: StockReservationStatus.RESERVED,
        quantity: 2,
        expiresAt: new Date(),
        secondsRemaining: 120,
        customerId: 'OTHER',
      }),
      extendReservation,
    });

    await expect(
      ctrl.extend(req(), 'r-1', { extraMinutes: 5 } as any),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
    expect(extendReservation).not.toHaveBeenCalled();
  });

  it('extends and returns the new expiresAt when the caller owns it', async () => {
    const newExpiresAt = new Date(Date.now() + 5 * 60_000);
    const ctrl = makeController({
      getReservation: jest.fn().mockResolvedValue({
        id: 'r-1',
        status: StockReservationStatus.RESERVED,
        quantity: 2,
        expiresAt: new Date(),
        secondsRemaining: 120,
        customerId: 'customer-1',
      }),
      extendReservation: jest.fn().mockResolvedValue({ expiresAt: newExpiresAt }),
    });

    const out = await ctrl.extend(req(), 'r-1', { extraMinutes: 5 } as any);
    expect(out.success).toBe(true);
    expect(out.data.expiresAt).toEqual(newExpiresAt);
  });
});
