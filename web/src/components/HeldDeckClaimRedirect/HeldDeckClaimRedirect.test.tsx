import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeldDeckClaimRedirect } from './HeldDeckClaimRedirect';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: vi.fn(),
}));

const getHeldDeck = vi.fn();

function renderAt(path: string, isLoggedIn: boolean) {
  vi.mocked(get2ankiApi).mockReturnValue({
    getHeldDeck,
  } as unknown as ReturnType<typeof get2ankiApi>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HeldDeckClaimRedirect isLoggedIn={isLoggedIn} />
      <Routes>
        <Route path="/notion" element={<p>notion</p>} />
        <Route path="/upload" element={<p>upload</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('HeldDeckClaimRedirect', () => {
  beforeEach(() => {
    getHeldDeck.mockReset();
    globalThis.sessionStorage?.clear();
  });

  it('redirects to /upload when a hold is waiting off the upload page', async () => {
    getHeldDeck.mockResolvedValue({ cardCount: 21, cardsHeldBack: 13 });
    const { findByText } = renderAt('/notion', true);
    expect(await findByText('upload')).toBeInTheDocument();
  });

  it('still redirects when StrictMode runs the effect twice', async () => {
    getHeldDeck.mockResolvedValue({ cardCount: 21, cardsHeldBack: 13 });
    vi.mocked(get2ankiApi).mockReturnValue({
      getHeldDeck,
    } as unknown as ReturnType<typeof get2ankiApi>);
    const { findByText } = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/notion']}>
          <HeldDeckClaimRedirect isLoggedIn={true} />
          <Routes>
            <Route path="/notion" element={<p>notion</p>} />
            <Route path="/upload" element={<p>upload</p>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>
    );
    expect(await findByText('upload')).toBeInTheDocument();
  });

  it('stays put when there is no hold', async () => {
    getHeldDeck.mockResolvedValue(null);
    const { findByText } = renderAt('/notion', true);
    expect(await findByText('notion')).toBeInTheDocument();
  });

  it('does not check when signed out', async () => {
    renderAt('/notion', false);
    await waitFor(() => expect(getHeldDeck).not.toHaveBeenCalled());
  });

  it('does not check on the upload page itself', async () => {
    renderAt('/upload', true);
    await waitFor(() => expect(getHeldDeck).not.toHaveBeenCalled());
  });
});
