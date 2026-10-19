import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { getToggleColor } from './getToggleColor';

const asBlock = (block: unknown) => block as BlockObjectResponse;

describe('getToggleColor', () => {
  it('returns the block-level colour of a toggle', () => {
    expect(
      getToggleColor(asBlock({ type: 'toggle', toggle: { color: 'red' } }))
    ).toBe('red');
  });

  it('returns the background colour of a toggle', () => {
    expect(
      getToggleColor(
        asBlock({ type: 'toggle', toggle: { color: 'red_background' } })
      )
    ).toBe('red_background');
  });

  it('returns the colour of a toggleable heading', () => {
    expect(
      getToggleColor(
        asBlock({
          object: 'block',
          type: 'heading_2',
          heading_2: { color: 'blue', is_toggleable: true },
        })
      )
    ).toBe('blue');
  });

  it('returns undefined for a non-toggleable heading', () => {
    expect(
      getToggleColor(
        asBlock({
          object: 'block',
          type: 'heading_1',
          heading_1: { color: 'blue', is_toggleable: false },
        })
      )
    ).toBeUndefined();
  });

  it('returns undefined for a non-toggle block', () => {
    expect(
      getToggleColor(
        asBlock({ type: 'paragraph', paragraph: { color: 'green' } })
      )
    ).toBeUndefined();
  });
});
