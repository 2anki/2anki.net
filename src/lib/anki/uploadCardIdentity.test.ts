import { cardFingerprint } from '../claude/ClaudeService';
import { guidFor } from './guid';
import {
  UPLOAD_IDENTITY_PREFIX,
  buildUploadIdentityLedger,
  hashSourceKey,
  packIdentitySource,
  resolveUploadIdentityGroup,
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

describe('resolveUploadIdentityGroup', () => {
  const front = { name: 'Front' };
  const keyFor = (ordinal: number) => uploadIdentityKey(front, ordinal);
  const sourceKeyHash = hashSourceKey('notes.md');
  const fp = (back: string) => cardFingerprint({ name: 'Front', back });

  it('issues guidFor(owner, key) for every card on first sight', () => {
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash,
      keyForOrdinal: keyFor,
      cards: [{ fingerprint: fp('a') }, { fingerprint: fp('b') }],
      ledger: {},
    });
    expect(resolved).toEqual([
      {
        identityKey: keyFor(1),
        guid: guidFor(OWNER, keyFor(1)),
        decision: 'issued',
      },
      {
        identityKey: keyFor(2),
        guid: guidFor(OWNER, keyFor(2)),
        decision: 'issued',
      },
    ]);
  });

  it('replays the stored guid when the answer was edited in the same file', () => {
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash,
      keyForOrdinal: keyFor,
      cards: [{ fingerprint: fp('new answer') }],
      ledger: {
        [keyFor(1)]: { guid: 'STORED', sourceKeyHash, fingerprint: fp('old') },
      },
    });
    expect(resolved).toEqual([
      { identityKey: keyFor(1), guid: 'STORED', decision: 'replayed' },
    ]);
  });

  it('replays the stored guid when the file was renamed', () => {
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash: hashSourceKey('new-name.md'),
      keyForOrdinal: keyFor,
      cards: [{ fingerprint: fp('same') }],
      ledger: {
        [keyFor(1)]: {
          guid: 'STORED',
          sourceKeyHash: hashSourceKey('old-name.md'),
          fingerprint: fp('same'),
        },
      },
    });
    expect(resolved[0]).toEqual({
      identityKey: keyFor(1),
      guid: 'STORED',
      decision: 'replayed',
    });
  });

  it('issues a fresh guarded guid when both filename and answer changed', () => {
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash: hashSourceKey('new-name.md'),
      keyForOrdinal: keyFor,
      cards: [{ fingerprint: fp('new answer') }],
      ledger: {
        [keyFor(1)]: {
          guid: 'STORED',
          sourceKeyHash: hashSourceKey('old-name.md'),
          fingerprint: fp('old answer'),
        },
      },
    });
    expect(resolved[0].decision).toBe('guarded');
    expect(resolved[0].guid).toBe(guidFor(OWNER, keyFor(1), fp('new answer')));
    expect(resolved[0].guid).not.toBe('STORED');
    expect(resolved[0].guid).not.toBe(guidFor(OWNER, keyFor(1)));
  });

  it('matches identical fronts to their stored rows by answer, not position', () => {
    const ledger = {
      [keyFor(1)]: { guid: 'G-A', sourceKeyHash, fingerprint: fp('A') },
      [keyFor(2)]: { guid: 'G-B', sourceKeyHash, fingerprint: fp('B') },
      [keyFor(3)]: { guid: 'G-C', sourceKeyHash, fingerprint: fp('C') },
    };
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash: hashSourceKey('renamed.md'),
      keyForOrdinal: keyFor,
      cards: [
        { fingerprint: fp('C') },
        { fingerprint: fp('A') },
        { fingerprint: fp('B') },
      ],
      ledger,
    });
    expect(resolved.map((r) => r.guid)).toEqual(['G-C', 'G-A', 'G-B']);
    expect(resolved.map((r) => r.identityKey)).toEqual([
      keyFor(3),
      keyFor(1),
      keyFor(2),
    ]);
    expect(resolved.every((r) => r.decision === 'replayed')).toBe(true);
  });

  it('forks an edited answer inside an identical-front group instead of guessing', () => {
    const ledger = {
      [keyFor(1)]: { guid: 'G-A', sourceKeyHash, fingerprint: fp('A') },
      [keyFor(2)]: { guid: 'G-B', sourceKeyHash, fingerprint: fp('B') },
    };
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash,
      keyForOrdinal: keyFor,
      cards: [{ fingerprint: fp('A') }, { fingerprint: fp('B, edited') }],
      ledger,
    });
    expect(resolved[0]).toEqual({
      identityKey: keyFor(1),
      guid: 'G-A',
      decision: 'replayed',
    });
    expect(resolved[1].decision).toBe('guarded');
    expect(resolved[1].identityKey).toBe(keyFor(2));
    expect(resolved[1].guid).not.toBe('G-B');
  });

  it('gives new copies of a known front the next free ordinals', () => {
    const ledger = {
      [keyFor(1)]: { guid: 'G-A', sourceKeyHash, fingerprint: fp('A') },
    };
    const resolved = resolveUploadIdentityGroup({
      owner: OWNER,
      sourceKeyHash,
      keyForOrdinal: keyFor,
      cards: [{ fingerprint: fp('new') }, { fingerprint: fp('A') }],
      ledger,
    });
    expect(resolved[1]).toEqual({
      identityKey: keyFor(1),
      guid: 'G-A',
      decision: 'replayed',
    });
    expect(resolved[0]).toEqual({
      identityKey: keyFor(2),
      guid: guidFor(OWNER, keyFor(2)),
      decision: 'issued',
    });
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
