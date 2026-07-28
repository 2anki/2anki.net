import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import DeckQualitySection from './DeckQualitySection';
import { DeckQualityCohort } from './conversionTypes';

function cohort(overrides: Partial<DeckQualityCohort> = {}): DeckQualityCohort {
  return {
    engine: 'parser',
    input_format: 'pdf',
    sample_size: 120,
    no_cards_count: 8,
    no_cards_rate: 8 / 128,
    enough_data: true,
    composite_p10: 0.41,
    composite_p50: 0.63,
    composite_p90: 0.82,
    card_count_p50: 34,
    median_back_len_p50: 180,
    blank_back_rate_p90: 0.05,
    ...overrides,
  };
}

describe('DeckQualitySection', () => {
  it('tells the reader the table fills over time when nothing is scored yet', () => {
    render(<DeckQualitySection cohorts={[]} />);
    expect(
      screen.getByText(/table fills as conversions run/)
    ).toBeInTheDocument();
  });

  it('renders a cohort row with its percentiles', () => {
    render(<DeckQualitySection cohorts={[cohort()]} />);
    expect(screen.getByText('Parser')).toBeInTheDocument();
    expect(screen.getByText('pdf')).toBeInTheDocument();
    expect(screen.getByText('0.63')).toBeInTheDocument();
  });

  it('keeps a thin cohort visible but shows no percentiles for it', () => {
    render(
      <DeckQualitySection
        cohorts={[
          cohort({
            sample_size: 4,
            enough_data: false,
            composite_p10: null,
            composite_p50: null,
            composite_p90: null,
            card_count_p50: null,
            median_back_len_p50: null,
            blank_back_rate_p90: null,
          }),
        ]}
      />
    );
    expect(screen.getByText('too few')).toBeInTheDocument();
    expect(screen.queryByText('0.63')).toBeNull();
  });

  it('separates the same format under different engines', () => {
    render(
      <DeckQualitySection
        cohorts={[cohort(), cohort({ engine: 'claude', composite_p50: 0.71 })]}
      />
    );
    expect(screen.getByText('Parser')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('0.71')).toBeInTheDocument();
  });
});
