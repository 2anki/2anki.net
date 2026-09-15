import {
  RESERVED_CREDITS_PER_INFLIGHT_CALL,
  releaseInflightCredits,
  reserveInflightCredits,
  reservedCreditsFor,
  resetInflightReservations,
} from './inflightReservations';

describe('inflight reservations', () => {
  beforeEach(() => resetInflightReservations());

  it('starts at zero for an unknown user', () => {
    expect(reservedCreditsFor(1)).toBe(0);
  });

  it('accumulates and releases reservations per user', () => {
    reserveInflightCredits(1, RESERVED_CREDITS_PER_INFLIGHT_CALL);
    reserveInflightCredits(1, RESERVED_CREDITS_PER_INFLIGHT_CALL);
    expect(reservedCreditsFor(1)).toBe(2 * RESERVED_CREDITS_PER_INFLIGHT_CALL);

    releaseInflightCredits(1, RESERVED_CREDITS_PER_INFLIGHT_CALL);
    expect(reservedCreditsFor(1)).toBe(RESERVED_CREDITS_PER_INFLIGHT_CALL);
  });

  it('keeps reservations isolated per user', () => {
    reserveInflightCredits(1, 5);
    reserveInflightCredits(2, 7);
    expect(reservedCreditsFor(1)).toBe(5);
    expect(reservedCreditsFor(2)).toBe(7);
  });

  it('drops the user entry once fully released', () => {
    reserveInflightCredits(3, 5);
    releaseInflightCredits(3, 5);
    expect(reservedCreditsFor(3)).toBe(0);
  });

  it('never goes negative when over-released', () => {
    reserveInflightCredits(4, 5);
    releaseInflightCredits(4, 10);
    expect(reservedCreditsFor(4)).toBe(0);
  });
});
