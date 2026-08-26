import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import PrintForm from './PrintForm';

const renderForm = () =>
  render(
    <MemoryRouter>
      <PrintForm />
    </MemoryRouter>
  );

const pickApkg = (name = 'deck.apkg') => {
  const file = new File(['fake'], name, { type: 'application/octet-stream' });
  const input = screen.getByLabelText(/Drop an Anki deck/i, {
    selector: 'input[type="file"]',
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

describe('PrintForm', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('shows the server card-limit message verbatim plus an Upgrade for unlimited link', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      clone() {
        return {
          json: async () => ({
            message:
              'This deck has 1873 cards. PDF export supports up to 1000 cards.',
          }),
        };
      },
    } as unknown as Response);

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(screen.getByText(/1873 cards/)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/PDF export supports up to 1000 cards/)
    ).toBeInTheDocument();

    const upgrade = screen.getByRole('link', {
      name: /Upgrade for unlimited/i,
    });
    expect(upgrade).toHaveAttribute('href', '/pricing');
  });

  test('shows a friendly corrupted-file message when the server reports Invalid .apkg', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      clone() {
        return {
          json: async () => ({ message: 'Invalid .apkg file' }),
        };
      },
    } as unknown as Response);

    renderForm();
    pickApkg();

    await waitFor(() => {
      expect(screen.getByText(/Couldn't read this file/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('link', { name: /Upgrade for unlimited/i })
    ).not.toBeInTheDocument();
  });
  test('accepts a dropped deck and posts it like a picked one', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      clone() {
        return {
          json: async () => ({ message: 'Invalid .apkg file' }),
        };
      },
    } as unknown as Response);

    renderForm();
    const zone = screen.getByText(/Drop an Anki deck/i).closest('label');
    expect(zone).not.toBeNull();
    const file = new File(['fake'], 'deck.apkg', {
      type: 'application/octet-stream',
    });

    fireEvent.drop(zone!, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/apkg/pdf',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
