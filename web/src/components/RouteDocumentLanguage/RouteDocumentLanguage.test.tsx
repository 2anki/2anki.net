import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import i18n from '../../lib/i18n';
import { setRouteDocumentLanguage } from '../../lib/i18n/documentLanguage';
import { RouteDocumentLanguage } from './RouteDocumentLanguage';

function GoTo({ to }: Readonly<{ to: string }>) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {to}
    </button>
  );
}

function renderAt(start: string, next: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <RouteDocumentLanguage />
      <GoTo to={next} />
    </MemoryRouter>
  );
}

describe('RouteDocumentLanguage', () => {
  afterEach(async () => {
    setRouteDocumentLanguage(null);
    await i18n.changeLanguage('en');
  });

  it('holds a German landing page at de and hands back on leaving', () => {
    renderAt('/pdf-zu-anki', '/upload');
    expect(document.documentElement.lang).toBe('de');

    fireEvent.click(screen.getByRole('button', { name: '/upload' }));
    expect(document.documentElement.lang).toBe('en');
  });

  it('holds the terms page at en under a German app', async () => {
    await act(() => i18n.changeLanguage('de'));
    renderAt('/upload', '/documentation/reference/terms');
    expect(document.documentElement.lang).toBe('de');

    fireEvent.click(
      screen.getByRole('button', { name: '/documentation/reference/terms' })
    );
    expect(document.documentElement.lang).toBe('en');
  });

  it('follows a language switch made on a docs page', async () => {
    await act(() => i18n.changeLanguage('ja'));
    renderAt('/documentation/start-here/upload-a-file', '/');
    expect(document.documentElement.lang).toBe('en');

    await act(() => i18n.changeLanguage('de'));
    expect(document.documentElement.lang).toBe('de');
  });
});
