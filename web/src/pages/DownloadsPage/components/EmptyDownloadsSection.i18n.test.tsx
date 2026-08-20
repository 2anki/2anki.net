import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../../lib/i18n';
import { EmptyDownloadsSection } from './EmptyDownloadsSection';

function renderEmpty() {
  return render(
    <MemoryRouter>
      <EmptyDownloadsSection isEmpty />
    </MemoryRouter>
  );
}

describe('EmptyDownloadsSection in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the empty-state heading and body in German', () => {
    renderEmpty();
    expect(screen.getByText('Noch keine Stapel')).toBeInTheDocument();
    expect(
      screen.getByText(/um deinen ersten Stapel zu erstellen/i)
    ).toBeInTheDocument();
  });

  it('translates the empty-state actions', () => {
    renderEmpty();
    expect(screen.getByText('Stapel erstellen')).toBeInTheDocument();
    expect(screen.getByText('Datei hochladen')).toBeInTheDocument();
  });
});
