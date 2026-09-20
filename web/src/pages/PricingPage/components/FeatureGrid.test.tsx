import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { FeatureGrid } from './FeatureGrid';

describe('FeatureGrid', () => {
  it('renders the section heading', () => {
    render(<FeatureGrid />);
    expect(
      screen.getByRole('heading', { name: 'Everything 2anki does' })
    ).toBeInTheDocument();
  });

  it('surfaces the AI features (Claude chat and photo-to-deck)', () => {
    render(<FeatureGrid />);
    expect(screen.getByText('AI chat')).toBeInTheDocument();
    expect(
      screen.getByText('Draft and refine cards with Claude')
    ).toBeInTheDocument();
    expect(screen.getByText('Photo to deck')).toBeInTheDocument();
  });

  it('surfaces deck sharing and both Notion directions', () => {
    render(<FeatureGrid />);
    expect(screen.getByText('Deck sharing')).toBeInTheDocument();
    expect(screen.getByText('Notion → Anki')).toBeInTheDocument();
    expect(screen.getByText('Anki → Notion')).toBeInTheDocument();
  });

  it('states that every plan includes the features', () => {
    render(<FeatureGrid />);
    expect(
      screen.getByText(
        'Every plan includes all of it, free included. Paid plans raise the limits.'
      )
    ).toBeInTheDocument();
  });
});
