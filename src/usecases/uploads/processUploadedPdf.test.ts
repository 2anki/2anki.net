import { processUploadedPdf } from './processUploadedPdf';
import CardOption from '../../lib/parser/Settings/CardOption';

function settingsWith(overrides: Record<string, string>) {
  return new CardOption({ ...CardOption.LoadDefaultOptions(), ...overrides });
}

describe('processUploadedPdf', () => {
  it('converts a directly uploaded PDF even when ZIP PDFs are switched off', () => {
    const settings = settingsWith({ 'process-pdfs': 'false' });

    const result = processUploadedPdf('lecture.pdf', settings);

    expect(result.processPDFs).toBe(true);
    expect(result).toBeInstanceOf(CardOption);
  });

  it('leaves the saved settings untouched', () => {
    const settings = settingsWith({ 'process-pdfs': 'false' });

    processUploadedPdf('lecture.pdf', settings);

    expect(settings.processPDFs).toBe(false);
  });

  it('keeps the switch for any other upload', () => {
    const settings = settingsWith({ 'process-pdfs': 'false' });

    expect(processUploadedPdf('notes.html', settings)).toBe(settings);
  });

  it('returns the same settings when PDFs are already on', () => {
    const settings = settingsWith({});

    expect(processUploadedPdf('lecture.pdf', settings)).toBe(settings);
  });
});
