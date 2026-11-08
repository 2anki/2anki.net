import {
  ClaudeLargeSectionError,
  ClaudeParseError,
  ClaudeRefusalError,
  EmptyContentError,
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
      'No cards from week 3.pdf: Claude declined it. The other files are in your deck.'
    );
  });

  it('lists several failed files with their reasons', () => {
    expect(
      aiFileFailedWarningText([
        aiFileFailedWarning('a.html', 'too_large'),
        aiFileFailedWarning('b.md', 'no_text'),
      ])
    ).toBe(
      'No cards from 2 files: a.html (a section was too large for Claude), b.md (Claude found no text to make cards from). The other files are in your deck.'
    );
  });

  it('keeps a colon in a file name', () => {
    expect(
      aiFileFailedWarningText([
        aiFileFailedWarning('Ch 1: Cells.md', 'unreadable'),
      ])
    ).toBe(
      "No cards from Ch 1: Cells.md: Claude's answer could not be read. The other files are in your deck."
    );
  });

  it('says nothing when no file failed', () => {
    expect(aiFileFailedWarningText(['markdown-heuristic'])).toBeNull();
  });
});
