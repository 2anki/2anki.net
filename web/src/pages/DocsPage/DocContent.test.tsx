import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DocContent } from './DocContent';

function renderAt(slug: string, path = '/documentation/*') {
  return render(
    <MemoryRouter initialEntries={[`/documentation/${slug}`]}>
      <Routes>
        <Route path={path} element={<DocContent slug={slug} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DocContent markdown link rewriting', () => {
  it('keeps /documentation/... links unchanged (no double prefix)', () => {
    renderAt('help/limits');
    const links = Array.from(
      document.querySelectorAll('a[href^="/documentation/"]')
    ).map((a) => a.getAttribute('href') ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href).not.toMatch(/^\/documentation\/documentation\//);
    }
  });

  it('keeps /pricing as a top-level app route', () => {
    renderAt('help/limits');
    const pricing = Array.from(document.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === '/pricing'
    );
    expect(pricing).toBeTruthy();
  });

  it('renders external links with target=_blank', () => {
    renderAt('reference/self-hosting');
    const ext = Array.from(document.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === 'https://github.com/2anki/server'
    );
    expect(ext).toBeTruthy();
    expect(ext?.getAttribute('target')).toBe('_blank');
  });

  it('renders the Not found state for an unknown slug', () => {
    renderAt('does/not/exist');
    expect(
      screen.getByRole('heading', { level: 1, name: /not found/i })
    ).toBeInTheDocument();
  });
});

const wrapTextNodesInFont = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node != null) {
    if ((node.textContent ?? '').trim().length > 0) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const font = document.createElement('font');
    textNode.parentNode?.insertBefore(font, textNode);
    font.appendChild(textNode);
  }
};

function docAt(slug: string) {
  return (
    <MemoryRouter initialEntries={[`/documentation/${slug}`]}>
      <Routes>
        <Route path="/documentation/*" element={<DocContent slug={slug} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DocContent survives browser translation across navigation', () => {
  it('renders the next doc after a translation tool wraps text in font tags', () => {
    const { rerender } = render(docAt('start-here/what-is-2anki'));
    const article = document.querySelector('article') as HTMLElement;
    expect(article).not.toBeNull();
    wrapTextNodesInFont(article);
    rerender(docAt('start-here/connect-notion'));
    expect(
      screen.getByRole('heading', { level: 1, name: /connect notion/i })
    ).toBeInTheDocument();
  });
});

describe('DocContent custom element embedding', () => {
  it('renders both overlapping-cloze demos from the markdown', () => {
    renderAt('cards/overlapping-cloze');
    const previews = screen.getAllByLabelText(
      'Preview: each card hides one line of the list'
    );
    expect(previews).toHaveLength(2);
  });
});

describe('DocContent tables', () => {
  it('puts every table in a container that scrolls sideways at phone width', () => {
    const { container } = renderAt('reference/self-hosting');

    const tables = container.querySelectorAll('table');
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.parentElement?.className).toContain('tableScroll');
      expect(table.parentElement?.getAttribute('tabindex')).toBe('0');
    }
  });
});
