import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import i18n from '../../lib/i18n';
import deDocs from '../../lib/i18n/locales/de/docs.json';
import { DocsSearch } from './DocsSearch';
import { DocsSearchTrigger } from './DocsSearchTrigger';
import { DocContent } from './DocContent';
import { CodeBlock } from './CodeBlock';
import { WipBanner } from './WipBanner';
import { DocsSidebar } from './DocsSidebar';
import { DocsHome } from './DocsHome';

function inRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Docs chrome in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the search trigger button', () => {
    inRouter(<DocsSearchTrigger onOpen={vi.fn()} />);
    expect(screen.getByText(deDocs.search.trigger)).toBeInTheDocument();
    expect(screen.queryByText('Search docs')).not.toBeInTheDocument();
  });

  it('translates the search dialog label', () => {
    inRouter(<DocsSearch isOpen onClose={vi.fn()} />);
    expect(
      screen.getByRole('dialog', { name: deDocs.search.dialogLabel })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Search documentation' })
    ).not.toBeInTheDocument();
  });

  it('translates the not-found state', () => {
    render(
      <MemoryRouter initialEntries={['/documentation/unknown-slug-zzz']}>
        <Routes>
          <Route
            path="/documentation/*"
            element={<DocContent slug="unknown-slug-zzz" />}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: deDocs.content.notFoundTitle,
      })
    ).toBeInTheDocument();
    expect(screen.queryByText('Not found')).not.toBeInTheDocument();
  });

  it('translates the code block copy button', () => {
    inRouter(<CodeBlock>echo hi</CodeBlock>);
    expect(
      screen.getByRole('button', { name: deDocs.code.copyAria })
    ).toBeInTheDocument();
    expect(screen.getByText(deDocs.code.copy)).toBeInTheDocument();
    expect(screen.queryByText('Copy')).not.toBeInTheDocument();
  });

  it('translates the work-in-progress banner', () => {
    inRouter(<WipBanner />);
    expect(
      screen.getByText(/mit Hilfe von KI neu geschrieben/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/being rewritten with help from AI/i)
    ).not.toBeInTheDocument();
  });

  it('translates the docs sidebar landmark label', () => {
    inRouter(<DocsSidebar />);
    expect(
      screen.getByRole('navigation', { name: deDocs.sidebar.label })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Documentation' })
    ).not.toBeInTheDocument();
  });

  it('translates the docs home hero', () => {
    inRouter(<DocsHome />);
    expect(
      screen.getByRole('heading', { level: 1, name: deDocs.home.title })
    ).toBeInTheDocument();
    expect(screen.queryByText('2anki documentation')).not.toBeInTheDocument();
  });
});
