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

describe('deck-builder crash and Claude refusal copy in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['deck_builder_crash', 'Beim Erstellen dieses Stapels'],
    ['claude_refusal', 'Claude hat abgelehnt'],
  ] as const)(
    'translates %s instead of showing the English server message',
    (code, german) => {
      const body: UploadErrorBody = { code, message: 'English server text' };
      const result = classifyUploadError(body);
      expect(result.title).toContain(german);
      expect(result.detail).toContain('support@2anki.net');
    }
  );
});

describe('classifyUploadError translated answers', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('words a page range past the end of the PDF in German', async () => {
    await i18n.changeLanguage('de');
    expect(
      classifyUploadError({
        code: 'pdf_page_range',
        message: 'Pages 11-14 are past the end of this 10-page PDF.',
        page_range: { reason: 'past_end', first: 11, last: 14, pageCount: 10 },
      }).title
    ).toBe('Die Seiten 11-14 liegen hinter dem Ende dieses 10-seitigen PDFs.');
  });

  it.each([
    ['es', 1, 'La página 2 está después del final de este PDF de 1 página.'],
    ['pl', 3, 'Strona 4 wykracza poza koniec tego PDF-a (3 strony).'],
    ['pl', 5, 'Strona 6 wykracza poza koniec tego PDF-a (5 stron).'],
  ])(
    'takes the %s plural form of a %i-page PDF',
    async (language, pageCount, title) => {
      await i18n.changeLanguage(language);
      expect(
        classifyUploadError({
          code: 'pdf_page_range',
          message: 'English server text',
          page_range: {
            reason: 'past_end',
            first: pageCount + 1,
            last: pageCount + 1,
            pageCount,
          },
        }).title
      ).toBe(title);
    }
  );

  it('names the over-long deck name setting in Spanish', async () => {
    await i18n.changeLanguage('es');
    expect(
      classifyUploadError({
        code: 'setting_too_long',
        message: 'Your saved deck name is too long.',
        setting: 'deck_name',
      })
    ).toEqual({
      title: 'El nombre del mazo que guardaste es demasiado largo.',
      detail:
        'Acórtalo en Nombre del mazo dentro de Ajustes y vuelve a subir el archivo.',
    });
  });
});
