import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { CancelFlow } from './CancelFlow';

const LOCALES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'nl',
  'pl',
  'pt',
  'ru',
] as const;

const PERIOD_END_SECONDS = Date.parse('2030-01-01T00:30:00.000Z') / 1000;

interface CancelFlowCopy {
  accessUntil: string;
  accessUntilPeriodEnd: string;
}

function cancelFlowCopy(locale: string): CancelFlowCopy {
  const raw = readFileSync(
    join(__dirname, '../../../lib/i18n/locales', locale, 'account.json'),
    'utf8'
  );
  return (JSON.parse(raw) as { cancelFlow: CancelFlowCopy }).cancelFlow;
}

let originalZone: string | undefined;

beforeEach(() => {
  originalZone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
});

afterEach(async () => {
  process.env.TZ = originalZone;
  await i18n.changeLanguage('en');
});

describe('CancelFlow in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('translates reasons and the comment box but keeps the English reason value', () => {
    const onCancel = vi.fn();
    render(
      <CancelFlow
        isCancelling={false}
        access={{ kind: 'untilPeriodEnd', periodEnd: PERIOD_END_SECONDS }}
        onCancel={onCancel}
        onKeep={vi.fn()}
      />
    );

    expect(
      screen.getByRole('group', { name: 'Abo kündigen' })
    ).toBeInTheDocument();

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

  it('names the period end in German with its local date and time', () => {
    render(
      <CancelFlow
        isCancelling={false}
        access={{ kind: 'untilPeriodEnd', periodEnd: PERIOD_END_SECONDS }}
        onCancel={vi.fn()}
        onKeep={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'Du behältst den Zugang bis zum 1. Januar 2030 um 1:30, dem Ende des bezahlten Zeitraums. Deine Karte wird nicht mehr belastet.'
      )
    ).toBeInTheDocument();
  });
});

describe('CancelFlow access notice in every locale', () => {
  const english = cancelFlowCopy('en');

  it.each(LOCALES)(
    '%s carries a date placeholder in the dated notice and none in the undated one',
    (locale) => {
      const copy = cancelFlowCopy(locale);

      expect(copy.accessUntil).toContain('{{date}}');
      expect(copy.accessUntilPeriodEnd).not.toContain('{{');
    }
  );

  it.each(LOCALES.filter((locale) => locale !== 'en'))(
    '%s translates both notices rather than copying English',
    (locale) => {
      const copy = cancelFlowCopy(locale);

      expect(copy.accessUntil).not.toBe(english.accessUntil);
      expect(copy.accessUntilPeriodEnd).not.toBe(english.accessUntilPeriodEnd);
    }
  );

  it.each(LOCALES)(
    '%s renders the undated notice for a subscription with no period end',
    async (locale) => {
      await i18n.changeLanguage(locale);
      render(
        <CancelFlow
          isCancelling={false}
          access={{ kind: 'untilPeriodEnd', periodEnd: null }}
          onCancel={vi.fn()}
          onKeep={vi.fn()}
        />
      );

      expect(
        screen.getByText(cancelFlowCopy(locale).accessUntilPeriodEnd)
      ).toBeInTheDocument();
    }
  );
});
