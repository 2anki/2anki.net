import { ASYNC_PDF_MIN_BYTES, isSlowUpload } from './asyncSlowUploads';

const file = (originalname: string, size = 1000) => ({ originalname, size });

describe('isSlowUpload', () => {
  it.each(['deck.pptx', 'DECK.PPT', 'slides.odp'])(
    'sends a presentation (%s) to the background at any size',
    (name) => {
      expect(isSlowUpload([file(name)], 'ask')).toBe(true);
    }
  );

  it('sends a large PDF the person already answered for', () => {
    expect(
      isSlowUpload([file('notes.pdf', ASYNC_PDF_MIN_BYTES)], 'pairs')
    ).toBe(true);
  });

  it('keeps a large PDF on the normal path while its question is unanswered', () => {
    expect(isSlowUpload([file('notes.pdf', ASYNC_PDF_MIN_BYTES)], 'ask')).toBe(
      false
    );
  });

  it('keeps a small PDF on the normal path', () => {
    expect(
      isSlowUpload([file('notes.pdf', ASYNC_PDF_MIN_BYTES - 1)], 'pairs')
    ).toBe(false);
  });

  it.each(['notes.csv', 'page.html', 'notes.md', 'noextension'])(
    'keeps %s on the normal path',
    (name) => {
      expect(isSlowUpload([file(name, 50 * 1024 * 1024)], 'pairs')).toBe(false);
    }
  );

  it('keeps a multi-file upload on the normal path', () => {
    expect(isSlowUpload([file('a.pptx'), file('b.pptx')], 'pairs')).toBe(false);
  });
});
