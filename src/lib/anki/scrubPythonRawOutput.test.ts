import {
  buildUnknownPythonErrorContext,
  scrubPythonRawOutput,
  scrubPythonRawOutputTail,
} from './scrubPythonRawOutput';
import { PythonExitError } from './buildPythonExitError';

describe('scrubPythonRawOutput', () => {
  it('keeps python file basenames from traceback paths', () => {
    const raw =
      'Traceback (most recent call last):\n  File "/app/create_deck/create_deck.py", line 12, in <module>';
    expect(scrubPythonRawOutput(raw)).toBe(
      'Traceback (most recent call last):\n  File "create_deck.py", line 12, in <module>'
    );
  });

  it('redacts non-python absolute paths', () => {
    const raw = 'FileNotFoundError: /workspace/123/uploads/secret-notes.html';
    expect(scrubPythonRawOutput(raw)).toBe('FileNotFoundError: [path]');
  });

  it('redacts quoted filenames containing user-named content', () => {
    const raw =
      "OSError: cannot open 'My Biology Deck Week 4.html' for reading";
    expect(scrubPythonRawOutput(raw)).toBe(
      'OSError: cannot open [file] for reading'
    );
  });

  it('redacts email addresses', () => {
    const raw = 'ValueError: bad value for student@example.com in field';
    expect(scrubPythonRawOutput(raw)).toBe(
      'ValueError: bad value for [email] in field'
    );
  });

  it('redacts long token-like strings', () => {
    const raw = `KeyError: secret_ntn_${'a'.repeat(40)}`;
    expect(scrubPythonRawOutput(raw)).toBe('KeyError: [token]');
  });

  it('truncates output to 500 characters', () => {
    const raw = 'KeyError: nested lookup failed\n'.repeat(100);
    expect(scrubPythonRawOutput(raw)).toHaveLength(500);
  });
});

describe('scrubPythonRawOutputTail', () => {
  it('keeps the last 500 characters, where the exception line is', () => {
    const raw =
      '  File "/app/create_deck/create_deck.py", line 12, in <module>\n'.repeat(
        20
      ) + 'KeyError: missing note field';

    const tail = scrubPythonRawOutputTail(raw);

    expect(tail).toHaveLength(500);
    expect(tail.endsWith('KeyError: missing note field')).toBe(true);
  });

  it('redacts a filename before keeping the tail', () => {
    const raw =
      "FileNotFoundError: [Errno 2] No such file: 'Week 3 notes.apkg'";

    expect(scrubPythonRawOutputTail(raw)).toBe(
      'FileNotFoundError: [Errno 2] No such file: [file]'
    );
  });
});

describe('buildUnknownPythonErrorContext', () => {
  it('returns context with scrubbed raw output for an unknown PythonExitError', () => {
    const err = new PythonExitError('generic message', {
      kind: 'unknown',
      rawOutput: 'KeyError: /workspace/123/deck.html exploded',
      code: 1,
    });

    expect(buildUnknownPythonErrorContext(err)).toEqual({
      python_crash_kind: 'unknown',
      python_exit_code: 1,
      python_raw_output: 'KeyError: [path] exploded',
    });
  });

  it('returns null for a classified PythonExitError', () => {
    const err = new PythonExitError('markup message', {
      kind: 'invalid-markup',
      rawOutput: 'UserWarning: Field contained the following invalid HTML tags',
      code: 1,
    });

    expect(buildUnknownPythonErrorContext(err)).toBeNull();
  });

  it('returns null for an unknown PythonExitError with empty raw output', () => {
    const err = new PythonExitError('generic message', {
      kind: 'unknown',
      rawOutput: '',
      code: null,
    });

    expect(buildUnknownPythonErrorContext(err)).toBeNull();
  });

  it('returns null for a plain Error', () => {
    expect(buildUnknownPythonErrorContext(new Error('boom'))).toBeNull();
  });
});
