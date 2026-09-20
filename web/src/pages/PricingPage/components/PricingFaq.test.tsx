import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { PricingFaq } from './PricingFaq';
import { PRICING_FAQ } from '../pricingFaq';

describe('PricingFaq', () => {
  it('renders the Questions & answers heading', () => {
    render(<PricingFaq />);
    expect(
      screen.getByRole('heading', { name: 'Questions & answers' })
    ).toBeInTheDocument();
  });

  it('renders every FAQ question from the shared source', () => {
    render(<PricingFaq />);
    for (const item of PRICING_FAQ) {
      expect(screen.getByText(item.question)).toBeInTheDocument();
    }
  });

  it('renders the pay-once one-time payment question', () => {
    render(<PricingFaq />);
    expect(
      screen.getByText('Is there a one-time payment option?')
    ).toBeInTheDocument();
  });

  it('keeps the Pro answer price-neutral so it is true for every cohort', () => {
    const unlimited = PRICING_FAQ.find(
      (item) => item.question === 'What is the Pro plan?'
    );
    expect(unlimited?.answer).not.toMatch(/\$\d/);
    expect(unlimited?.answer).toContain('removes the 100-card limit');
  });

  it('shows answers in collapsible details elements', () => {
    const { container } = render(<PricingFaq />);
    expect(container.querySelectorAll('details').length).toBe(
      PRICING_FAQ.length
    );
  });
});
