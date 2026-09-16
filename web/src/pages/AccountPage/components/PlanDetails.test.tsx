import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';

vi.mock('../../../lib/hooks/useAiCredits', () => ({
  useAiCredits: vi.fn(),
}));

vi.mock('../utils/formatLongDate', () => ({
  formatLongDate: vi.fn(() => 'a date'),
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
    render(<PlanDetails subscriptionType="free" />);
    expect(screen.getByText(/180 AI credits, paused/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  it('renders no paused line for a free user without pack credits', () => {
    mockHook.mockReturnValue({ ...pausedState, credits: 0 });
    render(<PlanDetails subscriptionType="free" />);
    expect(screen.queryByText(/paused/)).toBeNull();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });
});
