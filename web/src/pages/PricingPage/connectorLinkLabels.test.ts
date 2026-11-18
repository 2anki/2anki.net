import { describe, expect, it } from 'vitest';
import { connectorLinkLabels } from './connectorLinkLabels';

describe('connectorLinkLabels', () => {
  it.each([
    ['k=partial&a=b', { kind: 'partial', arm: 'b' }],
    ['k=held&a=a', { kind: 'held', arm: 'a' }],
    ['k=limit', { kind: 'limit', arm: null }],
    ['a=b', { kind: null, arm: 'b' }],
    ['k=held&k=evil&a=a&a=b', { kind: 'held', arm: 'a' }],
  ])('reads %s', (query, labels) => {
    expect(connectorLinkLabels(new URLSearchParams(query))).toEqual(labels);
  });

  it.each(['', 'k=PARTIAL&a=B', 'k=upgrade&a=c', 'k=partial%26a%3Db', 'k=&a='])(
    'reads nothing from %j',
    (query) => {
      expect(connectorLinkLabels(new URLSearchParams(query))).toEqual({
        kind: null,
        arm: null,
      });
    }
  );
});
