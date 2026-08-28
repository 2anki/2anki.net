import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../../../lib/i18n';
import { ConversionResult } from './ConversionResult';

vi.mock('../../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

function renderResult(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('ConversionResult in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the success card count and helper', () => {
    renderResult(<ConversionResult variant="success" count={5} />);
    expect(screen.getByText('Karten')).toBeInTheDocument();
    expect(screen.getByText(/Bereit für Anki/i)).toBeInTheDocument();
    expect(screen.getByText(/Reihenfolge des Dokuments/i)).toBeInTheDocument();
  });

  it('translates the expired-Notion failure message', () => {
    renderResult(
      <ConversionResult
        variant="failed"
        title={null}
        failureReason="notion_token_expired"
        source="notion"
        onMapColumns={vi.fn()}
      />
    );
    expect(
      screen.getByText(/Notion-Verbindung abgelaufen/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Notion neu verbinden')).toBeInTheDocument();
  });

  it('translates the paywall headline for an exhausted free limit', () => {
    renderResult(
      <ConversionResult
        variant="paywalled"
        title={null}
        limit={100}
        cardsUsed={100}
      />
    );
    expect(
      screen.getByText(
        'Du hast deine 100 kostenlosen Karten diesen Monat erreicht'
      )
    ).toBeInTheDocument();
  });
});
