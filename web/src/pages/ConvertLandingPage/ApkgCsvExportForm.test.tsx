import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ApkgCsvExportForm from './ApkgCsvExportForm';

const mockTrack = vi.fn();

vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

function makeApkgFile(name = 'deck.apkg'): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
    type: 'application/octet-stream',
  });
}

describe('ApkgCsvExportForm', () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  });

  afterEach(() => {
    mockTrack.mockClear();
    vi.restoreAllMocks();
  });

  it('disables submit until the user picks a file', () => {
    render(<ApkgCsvExportForm />);
    const button = screen.getByRole('button', { name: /Export to CSV/i });
    expect(button).toBeDisabled();
  });

  it('rejects a non-.apkg file with an inline error and never calls fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    render(<ApkgCsvExportForm />);
    const input = screen.getByLabelText(
      /Choose \.apkg file/i
    ) as HTMLInputElement;
    const file = new File(['x'], 'notes.zip', { type: 'application/zip' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/isn’t an \.apkg/i);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the file to /api/apkg/csv and shows the note count on success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Model,Front,Back,Tags\r\nBasic,Q,A,\r\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="deck.csv"; filename*=UTF-8\'\'deck.csv',
          'X-Card-Count': '42',
        },
      })
    );
    render(<ApkgCsvExportForm />);
    const input = screen.getByLabelText(
      /Choose \.apkg file/i
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeApkgFile('Pharmacology.apkg')] },
    });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(screen.getByText(/Exported 42 notes/i)).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/apkg/csv');
    expect((init as RequestInit).method).toBe('post');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(mockTrack).toHaveBeenCalledWith('apkg_csv_exported', {
      noteCount: 42,
    });
  });

  it('does not track an export when the server returns an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 })
    );
    render(<ApkgCsvExportForm />);
    const input = screen.getByLabelText(
      /Choose \.apkg file/i
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeApkgFile()] } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('surfaces the server error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message:
            '250 notes — over the free limit of 100. Upgrade for no monthly cap.',
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    );
    render(<ApkgCsvExportForm />);
    const input = screen.getByLabelText(
      /Choose \.apkg file/i
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeApkgFile()] } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /over the free limit of 100/i
      );
    });
  });

  // Replaces a test that asserted a 401 sign-in prompt. Anonymous visitors are
  // no longer blocked at the route, so a 401 is not the shape this form sees;
  // the real contract is the 402 note-cap gate below.
  it('shows the note cap as a neutral gate, not an error alert', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message:
            'This deck has 340 notes. Without an account you can export 21.',
          note_count: 340,
          note_limit: 21,
          requires_account: true,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    );
    render(<ApkgCsvExportForm />);
    const input = screen.getByLabelText(
      /Choose \.apkg file/i
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeApkgFile()] } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/340 notes/);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Sign in to export/i })
    ).toHaveAttribute('href', '/login?redirect=/convert/apkg-to-csv');
  });

  it('offers only the upgrade path when a signed-in caller hits their cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'This deck has 250 notes. Your plan exports 100 per file.',
          note_count: 250,
          note_limit: 100,
          requires_account: false,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    );
    render(<ApkgCsvExportForm />);
    const input = screen.getByLabelText(
      /Choose \.apkg file/i
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeApkgFile()] } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/250 notes/);
    });
    expect(
      screen.queryByRole('link', { name: /Sign in to export/i })
    ).toBeNull();
  });

  it('tells anonymous visitors what they can export before they pick a file', () => {
    render(<ApkgCsvExportForm />);
    expect(screen.getByText(/Export up to 21 notes now/i)).toBeTruthy();
  });
});
