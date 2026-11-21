import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import i18n from '../../lib/i18n';
import DocsPage from './DocsPage';
import { DocsSearch } from './DocsSearch';

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

async function useAppLanguage(language: string) {
  await act(() => i18n.changeLanguage(language));
}

describe('DocsPage document language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('pins the page to English for an English doc under a Japanese app', async () => {
    await useAppLanguage('ja');
    renderAt('/documentation/start-here/upload-a-file');
    expect(document.documentElement.lang).toBe('en');
  });

  it('pins the page to German when the German copy is shown', async () => {
    await useAppLanguage('de');
    renderAt('/documentation/start-here/upload-a-file');
    expect(document.documentElement.lang).toBe('de');
  });

  it('pins the terms page to English under a German app', async () => {
    await useAppLanguage('de');
    renderAt('/documentation/reference/terms');
    expect(document.documentElement.lang).toBe('en');
  });

  it('hands the html lang back to the app language when the page closes', async () => {
    await useAppLanguage('ja');
    const { unmount } = renderAt('/documentation/start-here/upload-a-file');
    unmount();
    expect(document.documentElement.lang).toBe('ja');
  });

  it('marks the translated banner and search trigger with the app language', async () => {
    await useAppLanguage('ja');
    renderAt('/documentation/start-here/upload-a-file');
    expect(screen.getByRole('note')).toHaveAttribute('lang', 'ja');
    const sidebar = document.getElementById('docs-sidebar') as HTMLElement;
    expect(sidebar.querySelector('button')).toHaveAttribute('lang', 'ja');
  });

  it('marks the English sidebar labels inside a German page', async () => {
    await useAppLanguage('de');
    renderAt('/documentation/start-here/upload-a-file');
    const sidebar = document.getElementById('docs-sidebar') as HTMLElement;
    expect(sidebar.querySelector('a[href$="reference/terms"]')).toHaveAttribute(
      'lang',
      'en'
    );
    expect(
      sidebar.querySelector('a[href$="start-here/upload-a-file"]')
    ).toHaveAttribute('lang', 'de');
  });

  it('marks the search dialog with the app language and its English results as English', async () => {
    await useAppLanguage('ja');
    render(
      <MemoryRouter>
        <DocsSearch isOpen onClose={() => {}} />
      </MemoryRouter>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('lang', 'ja');
    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: 'notion' },
    });
    const results = within(dialog).getAllByRole('option');
    expect(results[0]).toHaveAttribute('lang', 'en');
  });

  it('keeps the docs home on the app language and marks its English cards', async () => {
    await useAppLanguage('ja');
    renderAt('/documentation');
    expect(document.documentElement.lang).toBe('ja');
    const card = screen.getByRole('link', { name: /Upload a file/ });
    expect(card.closest('[lang]')).toHaveAttribute('lang', 'en');
  });
});
