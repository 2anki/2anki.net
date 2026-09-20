import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../lib/i18n';
import { LoggedInSuccess } from './LoggedInSuccess';

describe('LoggedInSuccess in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('keeps the Pro plan name and renders German actions', () => {
    render(
      <MemoryRouter>
        <LoggedInSuccess firstName="Alex" />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('heading', { name: 'Du hast Pro' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Danke, Alex — dein Abo ist aktiv.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Stapel erstellen' })
    ).toBeInTheDocument();
  });
});
