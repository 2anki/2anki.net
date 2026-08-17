import { describe, expect, it } from 'vitest';
import { buildDocDescription, buildDocTitle } from './docMeta';

describe('buildDocTitle', () => {
  it('appends the docs suffix to the frontmatter title', () => {
    expect(buildDocTitle('Connect Notion')).toBe('Connect Notion — 2anki docs');
  });

  it('falls back to a generic title when no frontmatter title exists', () => {
    expect(buildDocTitle(undefined)).toBe('Documentation — 2anki docs');
    expect(buildDocTitle('')).toBe('Documentation — 2anki docs');
  });
});

describe('buildDocDescription', () => {
  it('prefers the frontmatter description verbatim', () => {
    expect(
      buildDocDescription(
        { description: 'How to connect your workspace.' },
        '# Heading\n\nSome body text.'
      )
    ).toBe('How to connect your workspace.');
  });

  it('falls back to the first prose paragraph, skipping headings', () => {
    const body =
      '# Connect Notion\n\nAuthorise 2anki to read the pages you pick.';
    expect(buildDocDescription({}, body)).toBe(
      'Authorise 2anki to read the pages you pick.'
    );
  });

  it('strips markdown link syntax from the fallback paragraph', () => {
    const body = 'See the [pricing page](/pricing) for the current plans.';
    expect(buildDocDescription({}, body)).toBe(
      'See the pricing page for the current plans.'
    );
  });

  it('truncates a long paragraph to about 155 characters with an ellipsis', () => {
    const body = 'word '.repeat(60).trim();
    const result = buildDocDescription({}, body);
    expect(result).not.toBeUndefined();
    expect(result!.length).toBeLessThanOrEqual(156);
    expect(result!.endsWith('…')).toBe(true);
  });

  it('returns undefined when there is no usable prose', () => {
    expect(
      buildDocDescription({}, '# Only a heading\n\n- a list item')
    ).toBeUndefined();
  });
});
