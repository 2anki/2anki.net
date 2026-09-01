import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '../../../lib/i18n';
import { PauseCard } from './PauseCard';

const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

describe('pause-card legacy-rate i18n keys', () => {
  it.each(LOCALES)(
    'has a legacyKeeps string with the {{plan}} placeholder in %s',
    (lang) => {
      const file = join(
        __dirname,
        '../../../lib/i18n/locales',
        lang,
        'account.json'
      );
      const { legacyKeeps } = JSON.parse(readFileSync(file, 'utf8')).pauseCard;
      expect(typeof legacyKeeps).toBe('string');
      expect(legacyKeeps).toContain('{{plan}}');
    }
  );
});

describe('PauseCard in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the pause offer and action in German', () => {
    render(
      <PauseCard
        planLabel="$7.99 / month"
        isLegacyRate={false}
        isPausing={false}
        pauseError=""
        onPause={vi.fn()}
      />
    );

    expect(screen.getByText(/Stattdessen pausieren/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Abo pausieren' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '2 Monate' })
    ).toBeInTheDocument();
  });

  it('renders the legacy retention line in German for a legacy sub', () => {
    render(
      <PauseCard
        planLabel="$2 / month"
        isLegacyRate
        isPausing={false}
        pauseError=""
        onPause={vi.fn()}
      />
    );

    expect(screen.getByText(/\$2 \/ month/)).toBeInTheDocument();
  });
});
