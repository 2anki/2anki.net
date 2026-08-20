import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenBlocksNotice } from './ForbiddenBlocksNotice';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('ForbiddenBlocksNotice', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  it('uses singular copy for one unshared part', () => {
    render(<ForbiddenBlocksNotice count={1} />);
    expect(
      screen.getByText(/1 part of this page isn't connected to 2anki/)
    ).toBeInTheDocument();
  });

  it('uses plural copy and shows the count for several unshared parts', () => {
    render(<ForbiddenBlocksNotice count={3} />);
    expect(
      screen.getByText(/3 parts of this page aren't connected to 2anki/)
    ).toBeInTheDocument();
  });

  it('fires the usage event with the count on mount', () => {
    render(<ForbiddenBlocksNotice count={3} />);
    expect(track).toHaveBeenCalledWith('notion_blocks_forbidden_notice_shown', {
      count: 3,
    });
  });
});
