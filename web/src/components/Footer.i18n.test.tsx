import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import i18n from '../lib/i18n';
import Footer from './Footer';

describe('Footer in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the section titles', () => {
    render(<Footer />);
    expect(screen.getByText('Produkt')).toBeInTheDocument();
    expect(screen.getByText('Rechtliches')).toBeInTheDocument();
  });

  it('keeps the seller disclosure link in Japanese', () => {
    render(<Footer />);
    expect(
      screen.getByRole('link', { name: '特定商取引法に基づく表記' })
    ).toHaveAttribute('href', '/tokushoho/');
  });

  it('translates the nav links via the common namespace', () => {
    render(<Footer />);
    expect(screen.getByRole('link', { name: 'Über uns' })).toHaveAttribute(
      'href',
      '/about/'
    );
    expect(screen.getByRole('link', { name: 'Doku' })).toHaveAttribute(
      'href',
      '/documentation/'
    );
  });
});
