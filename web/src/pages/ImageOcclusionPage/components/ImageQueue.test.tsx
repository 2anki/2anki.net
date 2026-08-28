import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ImageQueue } from './ImageQueue';
import { ImageEntry } from '../types';

function makeEntry(i: number): ImageEntry {
  return {
    id: `entry-${i}`,
    file: new File(['x'], `img${i}.jpg`, { type: 'image/jpeg' }),
    imageName: `img${i}.jpg`,
    header: '',
    rects: [],
    previewUrl: `blob:fake-${i}`,
    s3Key: null,
    uploading: false,
  };
}

function renderQueue(
  entries: ImageEntry[],
  isPaying: boolean,
  isNotionConnected = false,
  keptFirst: number | null = null
) {
  return render(
    <MemoryRouter>
      <ImageQueue
        entries={entries}
        activeIndex={0}
        keptFirst={keptFirst}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onHeaderChange={vi.fn()}
        isPaying={isPaying}
        isNotionConnected={isNotionConnected}
        onImportFromNotion={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('ImageQueue', () => {
  it('shows the add button when under the free tier limit', () => {
    renderQueue([makeEntry(0), makeEntry(1)], false);
    expect(screen.getByText('+ Upload images')).toBeTruthy();
  });

  it('disables the add button and shows upgrade notice at exactly the free tier limit', () => {
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    renderQueue(entries, false);
    const addBtn = screen.getByText('+ Upload images');
    expect(addBtn).toBeTruthy();
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/free plan/)).toBeTruthy();
  });

  it('shows the add button for paying users even at 3 images', () => {
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    renderQueue(entries, true);
    expect(screen.getByText('+ Upload images')).toBeTruthy();
    expect(screen.queryByText(/Free accounts/)).toBeNull();
  });

  it('shows the add button for paying users with many images', () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i));
    renderQueue(entries, true);
    expect(screen.getByText('+ Upload images')).toBeTruthy();
  });

  it('tells a free user how many of a trimmed pick were kept, ahead of the at-limit notice', () => {
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    renderQueue(entries, false, false, 2);
    expect(
      screen.getByText(
        'Added the first 2 — the free plan is 3 images per deck.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/You've added the 3 images/)).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Upgrade to add more' })
        .getAttribute('href')
    ).toBe('/pricing');
  });

  it('falls back to the at-limit notice when a trimmed pick kept nothing', () => {
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    renderQueue(entries, false, false, 0);
    expect(screen.getByText(/You've added the 3 images/)).toBeTruthy();
  });

  it('shows upgrade link pointing to /pricing', () => {
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    renderQueue(entries, false);
    const link = screen.getByRole('link', { name: /Upgrade/ });
    expect(link.getAttribute('href')).toBe('/pricing');
  });
});
