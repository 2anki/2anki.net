import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import PrintPreview, { PrintPreviewState } from './PrintPreview';

const baseProps = {
  state: 'ready' as PrintPreviewState,
  imageSrc: 'data:image/png;base64,AAA',
  totalCards: 42,
  previewedCards: 3,
  paying: false,
  freePrintAvailable: true as boolean | null,
  optionsChanged: false,
  downloadBusy: false,
  passBusy: false,
  errorMessage: null as string | null,
  onUpdatePreview: vi.fn(),
  onDownload: vi.fn(),
  onPass: vi.fn(),
  onPreviewAnother: vi.fn(),
};

const renderPreview = (overrides: Partial<typeof baseProps> = {}) =>
  render(
    <MemoryRouter>
      <PrintPreview {...baseProps} {...overrides} />
    </MemoryRouter>
  );

describe('PrintPreview', () => {
  it('captions a sliced preview with the previewed and total counts', () => {
    renderPreview({ totalCards: 42, previewedCards: 3 });
    expect(screen.getByText(/first 3 of 42 cards/i)).toBeInTheDocument();
  });

  it('captions a whole-deck preview as all cards', () => {
    renderPreview({ totalCards: 2, previewedCards: 2 });
    expect(screen.getByText(/all 2 cards/i)).toBeInTheDocument();
    expect(screen.queryByText(/of 2 cards/i)).not.toBeInTheDocument();
  });

  it('shows the download action and free-PDF hint for a free user with the print available', () => {
    const onDownload = vi.fn();
    renderPreview({ onDownload });
    const button = screen.getByRole('button', {
      name: /Download the full PDF/i,
    });
    fireEvent.click(button);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Uses your 1 free PDF this month/i)
    ).toBeInTheDocument();
  });

  it('shows the day pass and See all plans once the free print is used', () => {
    const onPass = vi.fn();
    renderPreview({ freePrintAvailable: false, onPass });
    fireEvent.click(screen.getByRole('button', { name: /Get a day pass/i }));
    expect(onPass).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('link', { name: /See all plans/i })
    ).toHaveAttribute('href', '/pricing');
    expect(screen.queryByText(/Uses your 1 free PDF/i)).not.toBeInTheDocument();
  });

  it('hides the free-PDF hint for a paying user', () => {
    renderPreview({ paying: true });
    expect(
      screen.getByRole('button', { name: /Download the full PDF/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Uses your 1 free PDF/i)).not.toBeInTheDocument();
  });

  it('offers Update preview only when options changed', () => {
    const onUpdatePreview = vi.fn();
    const { rerender } = renderPreview({ optionsChanged: false });
    expect(
      screen.queryByRole('button', { name: /Update preview/i })
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <PrintPreview
          {...baseProps}
          optionsChanged
          onUpdatePreview={onUpdatePreview}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /Update preview/i }));
    expect(onUpdatePreview).toHaveBeenCalledTimes(1);
  });

  it('toggles zoom on the preview image', () => {
    renderPreview();
    const zoom = screen.getByRole('button', { name: /first 3 of 42 cards/i });
    expect(zoom).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(zoom);
    expect(zoom).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the empty state with no payment ask', () => {
    renderPreview({ state: 'empty' });
    expect(screen.getByText(/no cards to print/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Download the full PDF/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Get a day pass/i })
    ).not.toBeInTheDocument();
  });

  it('renders the error state with the message and no payment ask', () => {
    renderPreview({ state: 'error', errorMessage: 'Something went wrong' });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Download the full PDF/i })
    ).not.toBeInTheDocument();
  });

  it('shows a rendering spinner while the preview is being made', () => {
    renderPreview({ state: 'rendering' });
    expect(screen.getByText(/Making your preview/i)).toBeInTheDocument();
  });
});
