import { CONVERSION_TRUNCATED_MESSAGE } from '../../infrastracture/adapters/fileConversion/claudeFileConversion';
import { AiCreditsExhaustedError } from '../claude/aiSpendGuard';
import { isExpectedUploadState } from './isExpectedUploadState';

const named = (name: string, message = 'boom') =>
  Object.assign(new Error(message), { name });

describe('isExpectedUploadState', () => {
  it.each([
    'EmptyDeckError',
    'EmptyContentError',
    'PythonZeroCardsError',
    'ClaudeParseError',
    'ClaudeLargeSectionError',
    'ImageOnlyContentError',
    'DeckTooLargeError',
  ])(
    'treats %s as a user input state even after the worker rebuilds it',
    (name) => {
      expect(isExpectedUploadState(named(name))).toBe(true);
    }
  );

  it.each([
    ['a truncated conversion', CONVERSION_TRUNCATED_MESSAGE],
    ['a corrupt PDF', 'pdfinfo_failed code=1'],
    ['an unreadable docx', 'docx_parse_failed: not a zip'],
    [
      'an Anki package uploaded as a source file',
      '"x.apkg" is already an Anki deck.',
    ],
  ])('treats %s as a user input state by its message', (_label, message) => {
    expect(isExpectedUploadState(new Error(message))).toBe(true);
  });

  it('treats an HTTP coded client fault such as the credits stop as expected', () => {
    expect(isExpectedUploadState(new AiCreditsExhaustedError())).toBe(true);
  });

  it.each([
    ['a missing pdfinfo binary', new Error('pdfinfo_spawn_failed: ENOENT')],
    [
      'a parser crash',
      Object.assign(new Error('crash'), { code: 'PARSER_CRASH' }),
    ],
    ['an unclassified error', new Error('something broke')],
  ])('does not treat %s as expected', (_label, error) => {
    expect(isExpectedUploadState(error)).toBe(false);
  });

  it('does not treat a non error value as expected', () => {
    expect(isExpectedUploadState('boom')).toBe(false);
    expect(isExpectedUploadState(undefined)).toBe(false);
  });
});
