import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import ChatPage from './ChatPage';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: {
      locals: { owner: 1, patreon: false, subscriber: true },
      user: { patreon: false, chat_consent_at: '2026-01-01T00:00:00.000Z' },
    },
    refetch: vi.fn(),
  }),
}));

vi.mock('../../lib/backend/api', () => ({
  post: vi.fn(),
  postMultipart: vi.fn(),
  get: vi.fn().mockResolvedValue({ used: 0, limit: 20 }),
  patch: vi.fn(),
  del: vi.fn(),
}));

function renderChatPage(path = '/chat') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ChatPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the empty-state heading and composer controls', async () => {
    renderChatPage();
    expect(
      screen.getByRole('heading', { name: 'Was lernst du gerade?' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Nachrichteneingabe' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Nachricht senden' })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Dateien anhängen' })
      ).toBeInTheDocument()
    );
  });

  it('translates the upload-origin heading', () => {
    renderChatPage('/chat?from=upload&filename=notes.pdf');
    expect(
      screen.getByRole('heading', {
        name: 'Was möchtest du mit dieser Datei tun?',
      })
    ).toBeInTheDocument();
  });
});
