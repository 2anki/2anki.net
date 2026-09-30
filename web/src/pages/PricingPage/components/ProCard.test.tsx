import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProCard } from './ProCard';

const prices = { monthlyCents: 799, annualCents: 6400 };

describe('ProCard', () => {
  it('sends the yearly interval when the yearly button is pressed', () => {
    const onUpgrade = vi.fn();
    render(
      <ProCard
        onUpgrade={onUpgrade}
        pending={null}
        yearlyAvailable
        {...prices}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /yearly/i }));

    expect(onUpgrade).toHaveBeenCalledWith('year');
  });

  it('sends the monthly interval when the monthly button is pressed', () => {
    const onUpgrade = vi.fn();
    render(
      <ProCard
        onUpgrade={onUpgrade}
        pending={null}
        yearlyAvailable
        {...prices}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monthly/i }));

    expect(onUpgrade).toHaveBeenCalledWith('month');
  });

  it('offers only the monthly interval where yearly is unavailable', () => {
    render(
      <ProCard
        onUpgrade={vi.fn()}
        pending={null}
        yearlyAvailable={false}
        {...prices}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /monthly/i })
    ).toBeInTheDocument();
  });

  it('leads with the yearly per-month price, not the monthly price', () => {
    render(
      <ProCard onUpgrade={vi.fn()} pending={null} yearlyAvailable {...prices} />
    );

    expect(screen.getByText('$5.33')).toBeInTheDocument();
    expect(screen.queryByText('$7.99')).not.toBeInTheDocument();
  });

  it('disables both intervals while one checkout is opening', () => {
    render(
      <ProCard onUpgrade={vi.fn()} pending="year" yearlyAvailable {...prices} />
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('marks only the pending interval as starting checkout', () => {
    render(
      <ProCard onUpgrade={vi.fn()} pending="year" yearlyAvailable {...prices} />
    );

    expect(
      screen.getByRole('button', { name: /starting checkout/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /monthly/i })
    ).toBeInTheDocument();
  });

  it('offers a retry on both intervals after a failed checkout', () => {
    render(
      <ProCard
        onUpgrade={vi.fn()}
        pending={null}
        yearlyAvailable
        error
        {...prices}
      />
    );

    expect(screen.getAllByRole('button', { name: /try again/i })).toHaveLength(
      2
    );
  });
});
