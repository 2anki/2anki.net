import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../lib/i18n';
import { CreateAccountNotice } from './CreateAccountNotice';

describe('CreateAccountNotice in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the headline and CTA in German', () => {
    render(
      <MemoryRouter>
        <CreateAccountNotice />
      </MemoryRouter>
    );
    expect(
      screen.getByText('Dieser Stapel existiert nur auf diesem Gerät')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Stapel sichern — kostenlos' })
    ).toBeInTheDocument();
  });
});
