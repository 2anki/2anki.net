import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SharePopover } from './SharePopover';
import * as sharedDeckLib from '../../lib/backend/getSharedDeck';

vi.mock('../../lib/backend/getSharedDeck', () => ({
  getActiveSharesForUploadKey: vi.fn(),
  createDeckShare: vi.fn(),
  revokeDeckShare: vi.fn(),
}));

const activeShare: sharedDeckLib.ActiveShare = {
  token: 'test-token',
  upload_key: 'test.apkg',
  url: 'https://2anki.net/s/test-token',
  created_at: new Date().toISOString(),
  view_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SharePopover', () => {
  it('opens the popover on button click', async () => {
    vi.mocked(sharedDeckLib.getActiveSharesForUploadKey).mockResolvedValue(
      activeShare
    );

    render(<SharePopover uploadKey="test.apkg" />);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Share this deck' })
      ).toBeInTheDocument();
    });
  });

  it('shows the share URL when active share exists', async () => {
    vi.mocked(sharedDeckLib.getActiveSharesForUploadKey).mockResolvedValue(
      activeShare
    );

    render(<SharePopover uploadKey="test.apkg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      const input = screen.getByRole('textbox', {
        name: 'Share link',
      }) as HTMLInputElement;
      expect(input.value).toBe('https://2anki.net/s/test-token');
    });
  });

  it('creates a new share when no active share exists', async () => {
    vi.mocked(sharedDeckLib.getActiveSharesForUploadKey).mockResolvedValue(
      null
    );
    vi.mocked(sharedDeckLib.createDeckShare).mockResolvedValue({
      token: 'new-token',
      url: 'https://2anki.net/s/new-token',
    });

    render(<SharePopover uploadKey="test.apkg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(sharedDeckLib.createDeckShare).toHaveBeenCalledWith('test.apkg');
    });
  });

  it('shows stop-sharing confirmation on Stop sharing click', async () => {
    vi.mocked(sharedDeckLib.getActiveSharesForUploadKey).mockResolvedValue(
      activeShare
    );

    render(<SharePopover uploadKey="test.apkg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => screen.getByText('Stop sharing'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));

    expect(
      screen.getByText('Stop sharing this deck? The link will stop working.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Keep sharing' })
    ).toBeInTheDocument();
  });

  it('calls revokeDeckShare and closes popover on confirm stop', async () => {
    vi.mocked(sharedDeckLib.getActiveSharesForUploadKey).mockResolvedValue(
      activeShare
    );
    vi.mocked(sharedDeckLib.revokeDeckShare).mockResolvedValue();

    render(<SharePopover uploadKey="test.apkg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => screen.getByText('Stop sharing'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));

    await waitFor(() => {
      expect(sharedDeckLib.revokeDeckShare).toHaveBeenCalledWith('test-token');
    });
  });
});
