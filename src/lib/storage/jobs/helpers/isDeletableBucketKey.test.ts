import {
  isDeletableBucketKey,
  isReservedKey,
  ORPHAN_GRACE_MS,
} from './isDeletableBucketKey';

const now = new Date('2026-07-27T12:00:00.000Z');
const old = new Date(now.getTime() - ORPHAN_GRACE_MS - 1000);
const recent = new Date(now.getTime() - 60 * 1000);

describe('isReservedKey', () => {
  it.each(['mindmaps/12/34/abc.png', 'io-drafts/12/abc.png'])(
    'reserves %s for the feature that owns it',
    (key) => {
      expect(isReservedKey(key)).toBe(true);
    }
  );

  it('does not reserve a plain upload key', () => {
    expect(isReservedKey('00f1bb131ea3644d6948993e16784252')).toBe(false);
  });
});

describe('isDeletableBucketKey', () => {
  const referenced = new Set(['kept-key']);

  it('deletes an old object that nothing references', () => {
    expect(
      isDeletableBucketKey({ Key: 'orphan', LastModified: old }, referenced, now)
    ).toBe(true);
  });

  it('keeps an object an uploads row still references', () => {
    expect(
      isDeletableBucketKey(
        { Key: 'kept-key', LastModified: old },
        referenced,
        now
      )
    ).toBe(false);
  });

  // The whole-bucket walk would otherwise wipe every mindmap image and
  // image-occlusion draft, since those keys are never in the uploads table.
  it.each(['mindmaps/1/2/a.png', 'io-drafts/1/a.png'])(
    'never deletes %s even when unreferenced and old',
    (key) => {
      expect(
        isDeletableBucketKey({ Key: key, LastModified: old }, referenced, now)
      ).toBe(false);
    }
  );

  // A deck is written to storage before its uploads row commits.
  it('keeps a recently written object so an in-flight upload survives', () => {
    expect(
      isDeletableBucketKey(
        { Key: 'just-uploaded', LastModified: recent },
        referenced,
        now
      )
    ).toBe(false);
  });

  it('keeps an object with no age information rather than guessing', () => {
    expect(isDeletableBucketKey({ Key: 'unknown-age' }, referenced, now)).toBe(
      false
    );
  });

  it('ignores an entry with no key', () => {
    expect(isDeletableBucketKey({ LastModified: old }, referenced, now)).toBe(
      false
    );
  });
});
