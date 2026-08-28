import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import i18n from '../../../lib/i18n';
import { ComparisonTable } from './ComparisonTable';

describe('ComparisonTable in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates feature labels while keeping plan names in English', async () => {
    render(<ComparisonTable unlimitedMonthlyPrice="$7.99" />);

    await waitFor(() =>
      expect(screen.getByText('Karten pro Monat')).toBeInTheDocument()
    );
    expect(screen.getByText('Lernwerkzeuge')).toBeInTheDocument();

    expect(screen.getByText('Free')).toBeInTheDocument();
  });
});
