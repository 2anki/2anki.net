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

  it('names the AI credits each pass includes, like the visible answer does', () => {
    const passes = PRICING_FAQ.find(
      (item) => item.question === 'Is there a one-time payment option?'
    );
    expect(passes?.answer).toContain('includes 300 AI credits');
    expect(passes?.answer).toContain('with 500 credits');
    expect(passes?.answer).toContain('with 1500 credits');
    expect(passes?.answer).not.toMatch(/full access/i);
  });

  it('answers how to pay, with PayPal and cards from any country', () => {
    render(<PricingFaq />);
    expect(screen.getByText('How can I pay?')).toBeInTheDocument();
    const payment = PRICING_FAQ.find(
      (item) => item.question === 'How can I pay?'
    );
    expect(payment?.answer).toContain('PayPal');
    expect(payment?.answer).toContain('issued in any country');
  });

  it('shows answers in collapsible details elements', () => {
    const { container } = render(<PricingFaq />);
    expect(container.querySelectorAll('details').length).toBe(
      PRICING_FAQ.length
    );
  });
});
