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
import { formatLongDate } from '../utils/formatLongDate';
import { AiCreditsAccountLine } from './AiCreditsAccountLine';

const mockHook = vi.mocked(useAiCredits);
const mockFormat = vi.mocked(formatLongDate);

const state = (over: Partial<AiCreditsState>): AiCreditsState => ({
  credits: 180,
  used: 0,
  allowance: 300,
  windowEnd: '2027-05-12T00:00:00.000Z',
  resets: 'period',
  ...over,
});

describe('AiCreditsAccountLine', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockHook.mockReset();
    mockFormat.mockClear();
    mockFormat.mockReturnValue('a date');
  });

  it('renders nothing for a plan without an allowance', () => {
    mockHook.mockReturnValue(state({ allowance: 0 }));
    const { container } = render(<AiCreditsAccountLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the balance and valid-through date without a buy link', () => {
    mockHook.mockReturnValue(state({ credits: 180 }));
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText(/180 AI credits, valid through/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('adds a used-this-period clause once spend is recorded', () => {
    mockHook.mockReturnValue(state({ credits: 212, used: 88 }));
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText('88 AI credits used this period.')
    ).toBeInTheDocument();
    expect(screen.getByText(/212 left, valid through/)).toBeInTheDocument();
  });

  it('pluralizes each count independently in the used-this-period line', () => {
    mockHook.mockReturnValue(state({ credits: 1, used: 1 }));
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText('1 AI credit used this period.')
    ).toBeInTheDocument();
    expect(screen.getByText(/1 left, valid through/)).toBeInTheDocument();
  });

  it('drops the valid-through date from the remaining clause when none is set', () => {
    mockHook.mockReturnValue(
      state({ credits: 212, used: 88, windowEnd: null })
    );
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText('88 AI credits used this period.')
    ).toBeInTheDocument();
    expect(screen.getByText('212 left.')).toBeInTheDocument();
  });

  it('keeps the unchanged balance line when nothing has been spent', () => {
    mockHook.mockReturnValue(state({ credits: 180, used: 0 }));
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText(/180 AI credits, valid through/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/used this period/)).toBeNull();
  });

  it('reads zero when the balance is spent', () => {
    mockHook.mockReturnValue(state({ credits: 0 }));
    render(<AiCreditsAccountLine />);
    expect(screen.getByText('0 AI credits.')).toBeInTheDocument();
  });

  it('formats a calendar-month reset in UTC', () => {
    mockHook.mockReturnValue(state({ resets: 'month' }));
    render(<AiCreditsAccountLine />);
    expect(mockFormat).toHaveBeenCalledWith(expect.any(Date), 'en', 'UTC');
  });

  it('formats a period reset in local time, not forced UTC', () => {
    mockHook.mockReturnValue(state({ resets: 'period' }));
    render(<AiCreditsAccountLine />);
    expect(mockFormat).toHaveBeenCalledWith(expect.any(Date), 'en', undefined);
  });

  it('formats a pass reset in local time, not forced UTC', () => {
    mockHook.mockReturnValue(state({ resets: 'pass' }));
    render(<AiCreditsAccountLine />);
    expect(mockFormat).toHaveBeenCalledWith(expect.any(Date), 'en', undefined);
  });
});
