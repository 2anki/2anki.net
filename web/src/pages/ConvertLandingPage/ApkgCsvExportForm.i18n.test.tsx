import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../lib/i18n';
import ApkgCsvExportForm from './ApkgCsvExportForm';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('ApkgCsvExportForm in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the file label and submit button', () => {
    render(<ApkgCsvExportForm />);
    expect(screen.getByText('.apkg-Datei auswählen')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Als CSV exportieren' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Export to CSV')).toBeNull();
  });

  it('translates the free-quota helper text', () => {
    render(<ApkgCsvExportForm />);
    expect(
      screen.getByText(/Exportiere jetzt bis zu 21 Notizen/i)
    ).toBeInTheDocument();
  });
});
