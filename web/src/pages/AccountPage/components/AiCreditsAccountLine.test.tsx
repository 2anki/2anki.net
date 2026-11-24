import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';

vi.mock('../../../lib/hooks/useAiCredits', () => ({
  useAiCredits: vi.fn(),
}));

vi.mock('../../../lib/hooks/useAiGift', () => ({
  useAiGift: vi.fn(),
}));

vi.mock('../utils/formatLongDate', () => ({
  formatLongDate: vi.fn(() => 'a date'),
}));

import { useAiCredits } from '../../../lib/hooks/useAiCredits';
import { useAiGift } from '../../../lib/hooks/useAiGift';
import { formatLongDate } from '../utils/formatLongDate';
import { formatGiftDate } from '../../../components/AiGift/AiGiftPresent';
import { AiCreditsAccountLine } from './AiCreditsAccountLine';

const mockHook = vi.mocked(useAiCredits);
const mockFormat = vi.mocked(formatLongDate);
const mockGift = vi.mocked(useAiGift);

const state = (over: Partial<AiCreditsState>): AiCreditsState => ({
  credits: 180,
  used: 0,
  allowance: 300,
  usable: true,
  windowEnd: '2027-05-12T00:00:00.000Z',
  resets: 'period',
  ...over,
});

describe('AiCreditsAccountLine', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockHook.mockReset();
    mockGift.mockReset();
    mockGift.mockReturnValue(null);
    mockFormat.mockClear();
    mockFormat.mockReturnValue('a date');
  });

  it('renders nothing with no plan and no grant credits', () => {
    mockHook.mockReturnValue(state({ usable: false, credits: 0 }));
    const { container } = render(<AiCreditsAccountLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a paused line when grant credits remain without an active plan', () => {
    mockHook.mockReturnValue(
      state({
        usable: false,
        allowance: 0,
        credits: 180,
        windowEnd: '2026-11-18T00:00:00.000Z',
        resets: 'pass',
      })
    );
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText(
        '180 AI credits, paused. Resubscribe to use them before a date.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Buy 250 credits for $5' })
    ).toBeNull();
  });

  it('pluralizes the paused line for a single credit', () => {
    mockHook.mockReturnValue(
      state({ usable: false, allowance: 0, credits: 1, resets: 'pass' })
    );
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText(
        '1 AI credit, paused. Resubscribe to use it before a date.'
      )
    ).toBeInTheDocument();
  });

  it('renders nothing when not usable and no window end is set', () => {
    mockHook.mockReturnValue(
      state({ usable: false, allowance: 0, credits: 180, windowEnd: null })
    );
    const { container } = render(<AiCreditsAccountLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the balance, valid-through date, and a buy action', () => {
    mockHook.mockReturnValue(state({ credits: 180 }));
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText(/180 AI credits, valid through/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buy 250 credits for $5' })
    ).toBeInTheDocument();
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

  it('reads zero and still offers a buy action when the balance is spent', () => {
    mockHook.mockReturnValue(state({ credits: 0 }));
    render(<AiCreditsAccountLine />);
    expect(screen.getByText('0 AI credits.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buy 250 credits for $5' })
    ).toBeInTheDocument();
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

describe('AiCreditsAccountLine free AI credits gift', () => {
  const EXPIRES = '2026-11-26T19:15:00.000Z';
  const expiry = () => formatGiftDate(EXPIRES, 'en');
  const claimed = (credits: number, expiresAt = EXPIRES) => ({
    state: 'claimed' as const,
    credits,
    expiresAt,
    feedbackDue: false,
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T19:15:00.000Z'));
    mockHook.mockReset();
    mockGift.mockReset();
    mockFormat.mockReturnValue('a date');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts the gift under the plan line and before the buy action', () => {
    mockHook.mockReturnValue(state({ credits: 300, windowEnd: null }));
    mockGift.mockReturnValue(claimed(100));
    render(<AiCreditsAccountLine />);
    const plan = screen.getByText('300 AI credits.');
    const gift = screen.getByText(
      `Plus 100 free AI credits until ${expiry()}.`
    );
    const buy = screen.getByRole('button', { name: 'Buy 250 credits for $5' });
    expect(
      plan.compareDocumentPosition(gift) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      gift.compareDocumentPosition(buy) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows the gift alone for a free account with no plan', () => {
    mockHook.mockReturnValue(
      state({ usable: false, allowance: 0, credits: 0, windowEnd: null })
    );
    mockGift.mockReturnValue(claimed(100));
    render(<AiCreditsAccountLine />);
    expect(
      screen.getByText(`100 free AI credits left until ${expiry()}.`)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows only the plan line without a gift', () => {
    mockHook.mockReturnValue(state({ credits: 300, windowEnd: null }));
    mockGift.mockReturnValue(null);
    render(<AiCreditsAccountLine />);
    expect(screen.getByText('300 AI credits.')).toBeInTheDocument();
    expect(screen.queryByText(/free AI credit/)).toBeNull();
  });

  it.each([
    ['the flag is off', { state: 'closed' as const, feedbackDue: false }],
    ['the gift is spent', claimed(0)],
    ['the gift expired', claimed(100, '2026-11-24T19:14:00.000Z')],
  ])('shows no gift line when %s', (_name, gift) => {
    mockHook.mockReturnValue(state({ credits: 300, windowEnd: null }));
    mockGift.mockReturnValue(gift);
    render(<AiCreditsAccountLine />);
    expect(screen.getByText('300 AI credits.')).toBeInTheDocument();
    expect(screen.queryByText(/free AI credit/)).toBeNull();
  });
});
