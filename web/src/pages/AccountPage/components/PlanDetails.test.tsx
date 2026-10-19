import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';

vi.mock('../../../lib/hooks/useAiCredits', () => ({
  useAiCredits: vi.fn(),
}));

vi.mock('../utils/formatLongDate', () => ({
  formatLongDate: vi.fn(() => '18 November 2026'),
}));

import { useAiCredits } from '../../../lib/hooks/useAiCredits';
import { PlanDetails } from './PlanDetails';

const mockHook = vi.mocked(useAiCredits);

const pausedState: AiCreditsState = {
  credits: 180,
  used: 70,
  allowance: 0,
  usable: false,
  windowEnd: '2026-11-18T00:00:00.000Z',
  resets: 'pass',
};

describe('PlanDetails', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockHook.mockReset();
  });

  it('shows the paused pack line in the free/lapsed branch', () => {
    mockHook.mockReturnValue(pausedState);
    render(<PlanDetails plan="free" />);
    expect(screen.getByText(/180 AI credits, paused/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  it('renders no paused line for a free user without pack credits', () => {
    mockHook.mockReturnValue({ ...pausedState, credits: 0 });
    render(<PlanDetails plan="free" />);
    expect(screen.queryByText(/paused/)).toBeNull();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  it('names the Pro plan without saying Premium or Unlimited', () => {
    mockHook.mockReturnValue(null);
    render(<PlanDetails plan="pro" />);
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText(/Premium/i)).toBeNull();
    expect(screen.queryByText(/Unlimited/i)).toBeNull();
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull();
  });

  it('names the Auto Sync plan', () => {
    mockHook.mockReturnValue(null);
    render(<PlanDetails plan="autoSync" />);
    expect(screen.getByText('Auto Sync')).toBeInTheDocument();
  });

  it('keeps the Lifetime plan name', () => {
    mockHook.mockReturnValue(null);
    render(<PlanDetails plan="lifetime" />);
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
  });

  it('names a Week Pass and shows its end date', () => {
    mockHook.mockReturnValue(null);
    render(
      <PlanDetails plan="weekPass" passExpiresAt="2026-11-18T00:00:00.000Z" />
    );
    expect(screen.getByText('Week Pass')).toBeInTheDocument();
    expect(screen.getByText(/18 November 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull();
  });
});
