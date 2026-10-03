import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../lib/i18n';
import { classifyError, classifyUploadError } from './getErrorMessage';
import type { UploadErrorBody } from '../../../types/UploadErrorBody';

describe('classifyError in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the network error copy in German', () => {
    const result = classifyError(new TypeError('Failed to fetch'));
    expect(result.title).toBe('2anki nicht erreichbar.');
    expect(result.detail).toBe('Prüfe deine Verbindung und versuch es erneut.');
  });

  it('renders session-expiry copy in German while keeping the /login target', () => {
    const result = classifyError(new Error('unauthorized'));
    expect(result.title).toBe('Sitzung abgelaufen.');
    expect(result.actionLink).toEqual({ text: 'Anmelden', to: '/login' });
  });

  it('renders the Notion reconnect copy in German while keeping the /notion target', () => {
    const result = classifyError(new Error('API token is invalid.'));
    expect(result.title).toBe('Deine Notion-Verbindung ist abgelaufen');
    expect(result.actionLink).toEqual({
      text: 'Notion neu verbinden',
      to: '/notion',
    });
  });

  it('keeps support@2anki.net verbatim in the German fallback detail', () => {
    const result = classifyError(undefined);
    expect(result.title).toBe('Etwas ist schiefgelaufen.');
    expect(result.detail).toContain('support@2anki.net');
  });

  it('does not translate a raw server message', () => {
    const result = classifyError(new Error('No active subscription.'));
    expect(result.title).toBe('No active subscription.');
  });
});

describe('classifyUploadError in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders unsupported_format copy in German with the format list verbatim', () => {
    const body: UploadErrorBody = {
      code: 'unsupported_format',
      message: 'raw',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe('Dieser Dateityp wird nicht unterstützt.');
    expect(result.detail).toBe(
      'Verwende .zip, .html, .md, .pdf, .docx, .xlsx, .pptx, .csv, .epub, .opml oder .txt.'
    );
  });

  it('keeps support@2anki.net verbatim in the German corrupted_apkg detail', () => {
    const body: UploadErrorBody = {
      code: 'corrupted_apkg',
      message: 'raw',
    };
    const result = classifyUploadError(body);
    expect(result.title).toBe('Diese .apkg-Datei ist beschädigt.');
    expect(result.detail).toContain('support@2anki.net');
  });
});
