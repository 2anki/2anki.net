import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PassFirstOffer } from './PassFirstOffer';
import { track } from '../../lib/analytics/track';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

const mockStartPassCheckout = vi.fn();
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout: mockStartPassCheckout }),
}));

describe('PassFirstOffer', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    mockStartPassCheckout.mockReset();
  });

  it('puts the Semester Pass first as the primary button and the Day Pass beside it', () => {
    render(<PassFirstOffer surface="test-wall" headline="184 cards ready" />);
    const [semester, day] = screen.getAllByRole('button');
    expect(semester).toHaveTextContent('Semester Pass · $29');
    expect(semester.className).toContain('primary');
    expect(day).toHaveTextContent('Day Pass · $6');
    expect(day.className).toContain('secondary');
    expect(screen.getByText('184 cards ready')).toBeInTheDocument();
  });

  it('starts a Semester Pass checkout tagged to its surface and reports the click', async () => {
    mockStartPassCheckout.mockResolvedValue({ status: 'error' });
    render(<PassFirstOffer surface="test-wall" />);

    fireEvent.click(screen.getByRole('button', { name: /Semester Pass/ }));

    expect(track).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'test-wall',
      plan: 'semester_pass',
    });
    expect(track).toHaveBeenCalledWith('paywall_pass_clicked', {
      surface: 'test-wall',
      plan: 'semester',
    });
    expect(mockStartPassCheckout).toHaveBeenCalledWith(
      '120d',
      undefined,
      'test-wall'
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start checkout."
    );
  });

  it('says when a pass is still running instead of a generic error', async () => {
    mockStartPassCheckout.mockResolvedValue({
      status: 'conflict',
      code: 'pass_still_active',
      expiresAt: '2026-11-08T12:00:00.000Z',
    });
    render(<PassFirstOffer surface="test-wall" />);

    fireEvent.click(screen.getByRole('button', { name: /Day Pass/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your pass runs until'
    );
  });
});
