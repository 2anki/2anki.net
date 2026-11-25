import { describe, expect, it } from 'vitest';
import { giftOfferOf, parseAiGiftStatus } from './aiGift';

const TERMS = {
  credits: 100,
  validDays: 7,
  endsAt: '2026-12-04T22:00:00.000Z',
  feedbackDue: false,
};

describe('parseAiGiftStatus', () => {
  it('reads an open gift with whether this account has credits', () => {
    expect(
      parseAiGiftStatus({
        state: 'open',
        hasCredits: true,
        claudeDefaultForPdf: true,
        ...TERMS,
      })
    ).toMatchObject({
      state: 'open',
      hasCredits: true,
      claudeDefaultForPdf: true,
    });
  });

  it('reads a grant with its clock', () => {
    expect(
      parseAiGiftStatus({
        state: 'claimed',
        hasCredits: true,
        expiresAt: '2026-12-02T12:00:00.000Z',
        firstUsed: true,
        ...TERMS,
        credits: 70,
      })
    ).toMatchObject({ state: 'claimed', credits: 70, firstUsed: true });
  });

  it('treats anything it cannot read as closed', () => {
    expect(parseAiGiftStatus({ state: 'open', credits: 100 })).toEqual({
      state: 'closed',
      feedbackDue: false,
    });
    expect(parseAiGiftStatus(null)).toEqual({
      state: 'closed',
      feedbackDue: false,
    });
  });
});

describe('giftOfferOf', () => {
  it('offers a signed-out visitor the gift without credits', () => {
    expect(
      giftOfferOf(
        parseAiGiftStatus({ state: 'open', hasCredits: false, ...TERMS })
      )
    ).toMatchObject({ hasCredits: false, credits: 100, expiresAt: null });
  });

  it('gives a grant in use its end date, and an unused one none', () => {
    const status = (firstUsed: boolean) =>
      parseAiGiftStatus({
        state: 'claimed',
        hasCredits: true,
        expiresAt: '2026-12-02T12:00:00.000Z',
        firstUsed,
        ...TERMS,
      });

    expect(giftOfferOf(status(true))?.expiresAt).toBe(
      '2026-12-02T12:00:00.000Z'
    );
    expect(giftOfferOf(status(false))?.expiresAt).toBeNull();
  });

  it.each([
    { state: 'closed', feedbackDue: false },
    { state: 'full', feedbackDue: false },
    {
      state: 'claimed',
      hasCredits: false,
      expiresAt: '2026-12-02T12:00:00.000Z',
      firstUsed: true,
      ...TERMS,
      credits: 0,
    },
  ])('offers nothing for %j', (raw) => {
    expect(giftOfferOf(parseAiGiftStatus(raw))).toBeNull();
  });
});
