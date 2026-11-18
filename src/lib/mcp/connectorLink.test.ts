import {
  connectorArmFor,
  parseConnectorArm,
  parseConnectorLimitKind,
  parseIsoDate,
  readConnectorLinkParams,
} from './connectorLink';

describe('connectorArmFor', () => {
  it.each([
    [2, 'b'],
    [10, 'b'],
    [1, 'a'],
    [7, 'a'],
    [null, 'a'],
  ] as const)('puts user %s in arm %s', (userId, arm) => {
    expect(connectorArmFor(userId)).toBe(arm);
  });
});

describe('parseConnectorLimitKind', () => {
  it.each(['partial', 'held', 'limit'])('accepts %s', (kind) => {
    expect(parseConnectorLimitKind(kind)).toBe(kind);
  });

  it.each([null, '', 'PARTIAL', 'partial ', 'other', 'toString', '__proto__'])(
    'rejects %j',
    (value) => {
      expect(parseConnectorLimitKind(value)).toBeNull();
    }
  );
});

describe('parseConnectorArm', () => {
  it.each(['a', 'b'])('accepts %s', (arm) => {
    expect(parseConnectorArm(arm)).toBe(arm);
  });

  it.each([null, '', 'A', 'c', 'ab', 'constructor'])('rejects %j', (value) => {
    expect(parseConnectorArm(value)).toBeNull();
  });
});

describe('parseIsoDate', () => {
  it.each(['2026-11-25', '2028-02-29', '2026-01-01'])('accepts %s', (date) => {
    expect(parseIsoDate(date)).toBe(date);
  });

  it.each([
    null,
    '',
    '2026-13-40',
    '2026-02-30',
    '2027-02-29',
    '2026-00-10',
    '2026-11-25T00:00:00Z',
    '26-11-25',
    '2026-1-5',
    ' 2026-11-25',
    '2026-11-25\n',
  ])('rejects %j', (value) => {
    expect(parseIsoDate(value)).toBeNull();
  });
});

describe('readConnectorLinkParams', () => {
  it('reads every valid parameter', () => {
    expect(
      readConnectorLinkParams(
        new URLSearchParams('ref=mcp&k=partial&a=b&held_until=2026-11-25')
      )
    ).toEqual({ kind: 'partial', arm: 'b', heldUntil: '2026-11-25' });
  });

  it('returns null for each missing or invalid parameter', () => {
    expect(
      readConnectorLinkParams(
        new URLSearchParams('ref=mcp&k=upgrade&a=z&held_until=2026-13-40')
      )
    ).toEqual({ kind: null, arm: null, heldUntil: null });
  });

  it('reads the first value of a repeated parameter', () => {
    expect(
      readConnectorLinkParams(new URLSearchParams('k=held&k=evil&a=a&a=b'))
    ).toEqual({ kind: 'held', arm: 'a', heldUntil: null });
  });

  it('does not decode a value into a second parameter', () => {
    expect(
      readConnectorLinkParams(new URLSearchParams('k=partial%26a%3Db'))
    ).toEqual({ kind: null, arm: null, heldUntil: null });
  });
});
