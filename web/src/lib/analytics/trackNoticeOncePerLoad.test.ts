import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetNoticesShownThisLoad,
  trackNoticeOncePerLoad,
} from './trackNoticeOncePerLoad';
import { track } from './track';

vi.mock('./track', () => ({
  track: vi.fn(),
}));

describe('trackNoticeOncePerLoad', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    forgetNoticesShownThisLoad();
  });

  it('tracks a keyed notice once per page load', () => {
    trackNoticeOncePerLoad('thin_deck_notice_shown', 'job:1:2', { cards: 3 });
    trackNoticeOncePerLoad('thin_deck_notice_shown', 'job:1:2', { cards: 4 });

    expect(vi.mocked(track).mock.calls).toEqual([
      ['thin_deck_notice_shown', { cards: 3 }],
    ]);
  });

  it('tracks every call that has no key', () => {
    trackNoticeOncePerLoad('thin_deck_notice_shown', undefined, { cards: 3 });
    trackNoticeOncePerLoad('thin_deck_notice_shown', undefined, { cards: 3 });

    expect(track).toHaveBeenCalledTimes(2);
  });

  it('keeps the same key apart for different events', () => {
    trackNoticeOncePerLoad('image_drop_notice_shown', 'upload:a.apkg', {});
    trackNoticeOncePerLoad('empty_back_notice_shown', 'upload:a.apkg', {});

    expect(vi.mocked(track).mock.calls.map(([name]) => name)).toEqual([
      'image_drop_notice_shown',
      'empty_back_notice_shown',
    ]);
  });

  it('tracks a key again after the page load is forgotten', () => {
    trackNoticeOncePerLoad('cherry_skipped_notice_shown', 'job:1:2', {});
    forgetNoticesShownThisLoad();
    trackNoticeOncePerLoad('cherry_skipped_notice_shown', 'job:1:2', {});

    expect(track).toHaveBeenCalledTimes(2);
  });
});
