import { cardFingerprint } from '../claude/ClaudeService';
import { guidFor } from './guid';
import {
  UPLOAD_IDENTITY_PREFIX,
  buildUploadIdentityLedger,
  hashSourceKey,
  packIdentitySource,
  resolveUploadCardGuid,
  unpackIdentitySource,
  uploadCardType,
  uploadIdentityKey,
} from './uploadCardIdentity';

const OWNER = 4242;

describe('uploadCardType', () => {
  it('maps the note flags to the same labels python uses', () => {
    expect(uploadCardType({ cloze: true })).toBe('cloze');
    expect(uploadCardType({ mcq: true })).toBe('mcq');
    expect(uploadCardType({ enableInput: true })).toBe('input');
    expect(uploadCardType({})).toBe('basic');
  });
});

describe('uploadIdentityKey', () => {
  it('is the u:-namespaced guid of the normalized front and card type', () => {
    const key = uploadIdentityKey({ name: '  <b>What</b> is  X? ', back: 'Y' });
    expect(key).toBe(
      `${UPLOAD_IDENTITY_PREFIX}${guidFor('what is x?', 'basic')}`
    );
  });

  it('is stable when only the back or the position changes', () => {
    const a = uploadIdentityKey({ name: 'Front', back: 'first answer' });
    const b = uploadIdentityKey({ name: 'Front', back: 'edited answer' });
    expect(a).toBe(b);
  });

  it('changes when the front changes', () => {
    const a = uploadIdentityKey({ name: 'Front one', back: 'answer' });
    const b = uploadIdentityKey({ name: 'Front two', back: 'answer' });
    expect(a).not.toBe(b);
  });

  it('suffixes the ordinal so identical fronts never collapse', () => {
    const first = uploadIdentityKey({ name: 'Front', back: 'a' }, 1);
    const second = uploadIdentityKey({ name: 'Front', back: 'b' }, 2);
    const third = uploadIdentityKey({ name: 'Front', back: 'c' }, 3);
    expect(second).toBe(`${first}#2`);
    expect(third).toBe(`${first}#3`);
    expect(new Set([first, second, third]).size).toBe(3);
  });
});

describe('hashSourceKey', () => {
  it('is stable and case/whitespace insensitive', () => {
    expect(hashSourceKey('Notes.md')).toBe(hashSourceKey('  notes.md '));
    expect(hashSourceKey('path/to/notes.md')).toBe(hashSourceKey('notes.md'));
  });

  it('differs when the filename differs', () => {
    expect(hashSourceKey('a.md')).not.toBe(hashSourceKey('b.md'));
  });
});

describe('pack/unpack identity source', () => {
  it('round-trips the source-key hash and fingerprint', () => {
    const skh = hashSourceKey('notes.md');
    const fp = cardFingerprint({ name: 'Front', back: 'Back' });
    const packed = packIdentitySource(skh, fp);
    expect(packed.length).toBeLessThanOrEqual(255);
    expect(unpackIdentitySource(packed)).toEqual({
      sourceKeyHash: skh,
      fingerprint: fp,
    });
  });
});

describe('resolveUploadCardGuid', () => {
  const identityKey = uploadIdentityKey({ name: 'Front', back: 'Back' });
  const sourceKeyHash = hashSourceKey('notes.md');
  const fingerprint = cardFingerprint({ name: 'Front', back: 'Back' });

  it('issues guidFor(owner, identityKey) on first sight', () => {
    const result = resolveUploadCardGuid({
      owner: OWNER,
      identityKey,
      sourceKeyHash,
      fingerprint,
    });
    expect(result).toEqual({
      decision: 'issued',
      guid: guidFor(OWNER, identityKey),
    });
  });

  it('replays the stored guid when the answer was edited in the same file', () => {
    const stored = {
      guid: 'STORED',
      sourceKeyHash,
      fingerprint: cardFingerprint({ name: 'Front', back: 'old answer' }),
    };
    const result = resolveUploadCardGuid({
      owner: OWNER,
      identityKey,
      sourceKeyHash,
      fingerprint: cardFingerprint({ name: 'Front', back: 'new answer' }),
      stored,
    });
    expect(result).toEqual({ decision: 'replayed', guid: 'STORED' });
  });

  it('replays the stored guid when the file was renamed', () => {
    const stored = {
      guid: 'STORED',
      sourceKeyHash: hashSourceKey('old-name.md'),
      fingerprint,
    };
    const result = resolveUploadCardGuid({
      owner: OWNER,
      identityKey,
      sourceKeyHash: hashSourceKey('new-name.md'),
      fingerprint,
      stored,
    });
    expect(result).toEqual({ decision: 'replayed', guid: 'STORED' });
  });

  it('issues a fresh guarded guid when both filename and answer changed', () => {
    const stored = {
      guid: 'STORED',
      sourceKeyHash: hashSourceKey('old-name.md'),
      fingerprint: cardFingerprint({ name: 'Front', back: 'old answer' }),
    };
    const editedFingerprint = cardFingerprint({
      name: 'Front',
      back: 'new answer',
    });
    const result = resolveUploadCardGuid({
      owner: OWNER,
      identityKey,
      sourceKeyHash: hashSourceKey('new-name.md'),
      fingerprint: editedFingerprint,
      stored,
    });
    expect(result.decision).toBe('guarded');
    expect(result.guid).toBe(guidFor(OWNER, identityKey, editedFingerprint));
    expect(result.guid).not.toBe('STORED');
    expect(result.guid).not.toBe(guidFor(OWNER, identityKey));
  });
});

describe('buildUploadIdentityLedger', () => {
  it('keeps only u:-prefixed rows and unpacks the source column', () => {
    const skh = hashSourceKey('notes.md');
    const fp = cardFingerprint({ name: 'Front', back: 'Back' });
    const ledger = buildUploadIdentityLedger({
      [`${UPLOAD_IDENTITY_PREFIX}abc`]: {
        guid: 'G',
        sourcePageId: packIdentitySource(skh, fp),
      },
      '3917ab29-a11e-8047-9d97-cf0f00b3c8f7': {
        guid: 'notion',
        sourcePageId: null,
      },
    });
    expect(ledger).toEqual({
      [`${UPLOAD_IDENTITY_PREFIX}abc`]: {
        guid: 'G',
        sourceKeyHash: skh,
        fingerprint: fp,
      },
    });
  });
});
