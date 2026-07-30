import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageDropNotice } from './ImageDropNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('ImageDropNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('uses singular copy for one dropped image', () => {
    render(<ImageDropNotice count={1} />);
    expect(
      screen.getByText(
        /1 image couldn't be downloaded and isn't in this deck\./
      )
    ).toBeInTheDocument();
  });

  it('uses plural copy and the count for multiple dropped images', () => {
    render(<ImageDropNotice count={4} />);
    expect(
      screen.getByText(
        /4 images couldn't be downloaded and aren't in this deck\./
      )
    ).toBeInTheDocument();
  });

  it('fires the usage event with the dropped count and notion source on mount', () => {
    render(<ImageDropNotice count={3} />);
    expect(track).toHaveBeenCalledWith('image_drop_notice_shown', {
      dropped_count: 3,
      source: 'notion',
    });
  });

  it('uses file-oriented copy for the upload source', () => {
    render(<ImageDropNotice count={2} source="upload" />);
    expect(
      screen.getByText(/links to them on other sites we couldn't reach/)
    ).toBeInTheDocument();
    expect(screen.getByText(/aren't in this deck/)).toBeInTheDocument();
  });

  it('says "your decks" for a multi-deck batch upload', () => {
    render(<ImageDropNotice count={3} source="upload" multipleDecks />);
    expect(screen.getByText(/aren't in your decks/)).toBeInTheDocument();
  });

  it('fires the usage event with the upload source when rendered for an upload', () => {
    render(<ImageDropNotice count={1} source="upload" />);
    expect(track).toHaveBeenCalledWith('image_drop_notice_shown', {
      dropped_count: 1,
      source: 'upload',
    });
  });

  it('uses PDF-specific copy for the pdf source', () => {
    render(<ImageDropNotice count={2} source="pdf" />);
    expect(
      screen.getByText(/images from your PDF aren't in this deck/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/we don't include images from PDFs yet/)
    ).toBeInTheDocument();
  });

  it('uses singular PDF copy for one dropped image', () => {
    render(<ImageDropNotice count={1} source="pdf" />);
    expect(
      screen.getByText(/1 image from your PDF isn't in this deck/)
    ).toBeInTheDocument();
  });

  it('fires the usage event with the pdf source', () => {
    render(<ImageDropNotice count={1} source="pdf" />);
    expect(track).toHaveBeenCalledWith('image_drop_notice_shown', {
      dropped_count: 1,
      source: 'pdf',
    });
  });
});
