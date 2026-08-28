import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { ComparisonTable } from './ComparisonTable';

describe('ComparisonTable', () => {
  it('renders a column for every plan', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    for (const plan of ['Free', 'Day / Week pass', 'Unlimited']) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(plan) })
      ).toBeInTheDocument();
    }
  });

  it('no longer offers a Lifetime column', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    expect(
      screen.queryByRole('columnheader', { name: /Lifetime/ })
    ).not.toBeInTheDocument();
  });

  it('shows the v2 cohort Unlimited price in the header', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    expect(screen.getByText('$7.99 / mo')).toBeInTheDocument();
    expect(screen.queryByText('$6 / mo')).not.toBeInTheDocument();
  });

  it('shows the legacy cohort Unlimited price in the header', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$6" />);
    expect(screen.getByText('$6 / mo')).toBeInTheDocument();
    expect(screen.queryByText('$7.99 / mo')).not.toBeInTheDocument();
  });

  it('shows the free plan card limit and the paid Unlimited value', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(0);
  });

  it('groups rows under category headers including AI', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    expect(
      screen.getByRole('columnheader', { name: 'Conversion limits' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'AI (Claude)' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Support' })
    ).toBeInTheDocument();
  });

  it('gates AI multiple choice and AI flashcards to paid tiers', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    const mcq = screen.getByRole('row', { name: /AI multiple choice/ });
    expect(within(mcq).getAllByText('Included').length).toBe(2);
    expect(within(mcq).getAllByText('Not included').length).toBe(1);
  });

  it('shows priority support as a paid-tier differentiator', () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);
    const row = screen.getByRole('row', { name: /Priority support/ });
    expect(within(row).getAllByText('Included').length).toBe(1);
    expect(within(row).getAllByText('Not included').length).toBe(2);
  });
});
