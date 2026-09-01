import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '../../../lib/i18n';
import { CancelFlow } from './CancelFlow';

const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'];

const readCancelFlow = (lang: string) => {
  const file = join(
    __dirname,
    '../../../lib/i18n/locales',
    lang,
    'account.json'
  );
  return JSON.parse(readFileSync(file, 'utf8')).cancelFlow;
};

describe('cancel-flow pause-first i18n keys', () => {
  it.each(LOCALES)('has stillWantToCancel and pauseOrCancel in %s', (lang) => {
    const cancelFlow = readCancelFlow(lang);
    expect(typeof cancelFlow.stillWantToCancel).toBe('string');
    expect(cancelFlow.stillWantToCancel.length).toBeGreaterThan(0);
    expect(typeof cancelFlow.pauseOrCancel).toBe('string');
    expect(cancelFlow.pauseOrCancel.length).toBeGreaterThan(0);
  });
});

describe('CancelFlow in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates reasons and the comment box but keeps the English reason value', () => {
    const onCancel = vi.fn();
    render(
      <CancelFlow
        planLabel={null}
        tenureDays={10}
        pauseEligible={false}
        isLegacyRate={false}
        isCancelling={false}
        isPausing={false}
        pauseError=""
        onCancel={onCancel}
        onKeep={vi.fn()}
        onPause={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Technische Probleme'));
    expect(
      screen.getByPlaceholderText('Was hat nicht funktioniert? (optional)')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'kaputt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Abo kündigen' }));

    expect(onCancel).toHaveBeenCalledWith('Technical issues', 'kaputt');
  });
});
