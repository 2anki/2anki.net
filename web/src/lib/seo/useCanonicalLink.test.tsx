import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCanonicalLink } from './useCanonicalLink';

function Page({ href }: Readonly<{ href?: string }>) {
  useCanonicalLink(href);
  return null;
}

const canonicalHrefs = (): Array<string | null> =>
  Array.from(document.head.querySelectorAll('link[rel="canonical"]')).map(
    (link) => link.getAttribute('href')
  );

const addStaticCanonical = (href: string) => {
  const link = document.createElement('link');
  link.setAttribute('rel', 'canonical');
  link.setAttribute('href', href);
  document.head.appendChild(link);
};

afterEach(() => {
  document.head
    .querySelectorAll('link[rel="canonical"]')
    .forEach((link) => link.remove());
});

describe('useCanonicalLink', () => {
  it('adds the canonical when the page has none', () => {
    render(<Page href="https://2anki.net/documentation/" />);
    expect(canonicalHrefs()).toEqual(['https://2anki.net/documentation/']);
  });

  it('takes over the prerendered canonical instead of adding a second', () => {
    addStaticCanonical('https://2anki.net/documentation/cards/mcq/');
    render(<Page href="https://2anki.net/documentation/cards/mcq/" />);
    expect(canonicalHrefs()).toEqual([
      'https://2anki.net/documentation/cards/mcq/',
    ]);
  });

  it('follows a navigation to another page', () => {
    addStaticCanonical('https://2anki.net/documentation/cards/mcq/');
    const { rerender } = render(
      <Page href="https://2anki.net/documentation/cards/mcq/" />
    );
    rerender(<Page href="https://2anki.net/documentation/cards/html/" />);
    expect(canonicalHrefs()).toEqual([
      'https://2anki.net/documentation/cards/html/',
    ]);
  });

  it('removes the canonical when the page goes away', () => {
    const { unmount } = render(
      <Page href="https://2anki.net/documentation/" />
    );
    unmount();
    expect(canonicalHrefs()).toEqual([]);
  });

  it('leaves the head alone when there is no canonical to set', () => {
    render(<Page />);
    expect(canonicalHrefs()).toEqual([]);
  });
});
