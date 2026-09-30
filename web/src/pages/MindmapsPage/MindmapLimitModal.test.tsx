import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MindmapLimitModal } from './MindmapLimitModal';

function renderModal(limit: number, canUpgrade = true) {
  return render(
    <MemoryRouter>
      <MindmapLimitModal
        limit={limit}
        canUpgrade={canUpgrade}
        onClose={() => {}}
      />
    </MemoryRouter>
  );
}

describe('MindmapLimitModal', () => {
  it('says how to make room without promising unlimited mind maps', () => {
    const { container } = renderModal(3);
    expect(screen.getByText(/Delete one to make room\./)).toBeDefined();
    expect(container.textContent).not.toMatch(/unlimited/i);
  });

  it('does not mention Auto Sync', () => {
    const { container } = renderModal(3);
    expect(container.textContent).not.toMatch(/Auto[\s-]?Sync/i);
  });

  it('renders the free cap when the limit is 3', () => {
    renderModal(3);
    expect(screen.getByText(/limit of 3 mind maps/)).toBeDefined();
    expect(screen.getByText(/includes 3 mind maps/)).toBeDefined();
  });

  it('renders the subscriber cap when the limit is 25', () => {
    renderModal(25);
    expect(screen.getByText(/limit of 25 mind maps/)).toBeDefined();
    expect(screen.getByText(/includes 25 mind maps/)).toBeDefined();
  });

  it('offers the upgrade to someone a purchase would actually help', () => {
    renderModal(3, true);

    expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute(
      'href',
      '/pricing?source=mindmap-limit'
    );
  });

  it('offers no upgrade at the subscriber cap, where nothing on the pricing page raises it', () => {
    renderModal(25, false);

    expect(screen.queryByRole('link', { name: /upgrade/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('closes rather than deferring when there is nothing to defer', () => {
    renderModal(25, false);

    expect(screen.getByRole('button', { name: /close/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /not now/i })).toBeNull();
  });
});
