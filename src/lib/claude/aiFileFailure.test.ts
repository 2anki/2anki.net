import {
  ClaudeLargeSectionError,
  ClaudeParseError,
  ClaudeRefusalError,
  ClaudeTruncatedError,
  EmptyContentError,
  ImageOnlyContentError,
} from './ClaudeService';
import {
  aiFileFailedWarning,
  aiFileFailedWarningText,
  aiFileFailureReason,
} from './aiFileFailure';

describe('aiFileFailureReason', () => {
  it.each([
    [new ClaudeRefusalError(), 'declined'],
    [new ClaudeLargeSectionError(), 'too_large'],
    [new EmptyContentError('empty'), 'no_text'],
    [new ClaudeParseError(), 'unreadable'],
    [new ImageOnlyContentError(), 'no_text'],
    [new ClaudeTruncatedError('chunk'), 'too_large'],
    [
      Object.assign(new Error('claude_parse_failed'), {
        chunkFileFailure: 'unreadable',
      }),
      'unreadable',
    ],
  ])('names %s', (error, reason) => {
    expect(aiFileFailureReason(error)).toBe(reason);
  });

  it('leaves an outage to fail the whole upload', () => {
    expect(aiFileFailureReason(new Error('overloaded'))).toBeNull();
  });
});

describe('aiFileFailedWarningText', () => {
  it('names one failed file and why', () => {
    expect(
      aiFileFailedWarningText([
        'markdown-heuristic',
        aiFileFailedWarning('notes/week 3.pdf', 'declined'),
      ])
    ).toBe(
      'No cards from week 3.pdf: Claude declined it, so reword or remove the part it would not answer. The other files are in your deck.'
    );
  });

  it('lists several failed files with their reasons', () => {
    expect(
      aiFileFailedWarningText([
        aiFileFailedWarning('a.html', 'too_large'),
        aiFileFailedWarning('b.md', 'no_text'),
      ])
    ).toBe(
      'No cards from 2 files: a.html (a section was too large, so split it and upload it again), b.md (Claude found no text to make cards from, so check the file has text in it). The other files are in your deck.'
    );
  });

  it('keeps a colon in a file name', () => {
    expect(
      aiFileFailedWarningText([
        aiFileFailedWarning('Ch 1: Cells.md', 'unreadable'),
      ])
    ).toBe(
      "No cards from Ch 1: Cells.md: Claude's answer could not be read, so upload it again. The other files are in your deck."
    );
  });

  it('lists three files and counts the rest', () => {
    const warnings = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      aiFileFailedWarning(`${name}.md`, 'no_text')
    );

    expect(aiFileFailedWarningText(warnings)).toBe(
      'No cards from 5 files: a.md (Claude found no text to make cards from, so check the file has text in it), b.md (Claude found no text to make cards from, so check the file has text in it), c.md (Claude found no text to make cards from, so check the file has text in it) and 2 more. The other files are in your deck.'
    );
  });

  it.each([
    ['a PDF converted inside a zip', 'lectures/week 3.pdf.html', 'week 3.pdf'],
    [
      'a Notion export page',
      'Export/Cell biology 0123456789abcdef0123456789abcdef.html',
      'Cell biology.html',
    ],
  ])('names %s the way it was uploaded', (_case, converted, shown) => {
    expect(
      aiFileFailedWarningText([aiFileFailedWarning(converted, 'declined')])
    ).toContain(`No cards from ${shown}: `);
  });

  it('says nothing when no file failed', () => {
    expect(aiFileFailedWarningText(['markdown-heuristic'])).toBeNull();
  });
});
