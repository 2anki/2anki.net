import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { ConfirmEmailNotice } from './ConfirmEmailNotice';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ requestMagicLink: vi.fn() }),
}));

describe('ConfirmEmailNotice in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the headline and CTA in German', () => {
    render(<ConfirmEmailNotice email="al@example.com" />);
    expect(
      screen.getByText('Komm von jedem Gerät zu deinen Stapeln zurück')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Schick mir einen Link zum Anmelden' })
    ).toBeInTheDocument();
  });
});
