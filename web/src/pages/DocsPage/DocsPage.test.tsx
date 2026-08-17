import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { describe, expect, it, vi } from 'vitest';
import DocsPage from './DocsPage';

vi.mock('./DocContent', () => ({
  DocContent: ({ slug }: { slug: string }) => <div>doc-content:{slug}</div>,
}));
vi.mock('./DocsHome', () => ({
  DocsHome: () => <div>docs-home</div>,
}));
vi.mock('./DocsSidebar', () => ({
  DocsSidebar: () => <nav>sidebar</nav>,
}));

function renderAt(path: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/documentation/*" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

function mainEl(): HTMLElement {
  return screen.getByRole('main');
}

describe('DocsPage', () => {
  it('does not mark the docs home as legal', () => {
    renderAt('/documentation');
    expect(mainEl()).not.toHaveAttribute('data-legal');
  });

  it('does not mark a regular doc page as legal', () => {
    renderAt('/documentation/start-here/connect-notion');
    expect(mainEl()).not.toHaveAttribute('data-legal');
  });

  it('marks the privacy policy page as legal', () => {
    renderAt('/documentation/reference/privacy');
    expect(mainEl()).toHaveAttribute('data-legal', 'true');
  });

  it('marks the terms of service page as legal', () => {
    renderAt('/documentation/reference/terms');
    expect(mainEl()).toHaveAttribute('data-legal', 'true');
  });

  it('marks the legal page even with a trailing slash', () => {
    renderAt('/documentation/reference/privacy/');
    expect(mainEl()).toHaveAttribute('data-legal', 'true');
  });
});

describe('DocsPage metadata', () => {
  it('sets a per-doc title and a self-referencing canonical', async () => {
    renderAt('/documentation/start-here/connect-notion');
    await waitFor(() => {
      expect(document.title.endsWith(' — 2anki docs')).toBe(true);
    });
    expect(document.title).not.toBe('Documentation — 2anki docs');
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical).toHaveAttribute(
      'href',
      'https://2anki.net/documentation/start-here/connect-notion'
    );
  });

  it('uses the generic docs title on the documentation home', async () => {
    renderAt('/documentation');
    await waitFor(() => {
      expect(document.title).toBe('Documentation — 2anki docs');
    });
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical).toHaveAttribute(
      'href',
      'https://2anki.net/documentation'
    );
  });
});
