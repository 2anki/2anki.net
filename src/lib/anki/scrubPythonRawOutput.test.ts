import { buildUnknownPythonErrorContext } from './scrubPythonRawOutput';
import { PythonExitError } from './buildPythonExitError';

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
      python_raw_output: 'KeyError: [path]',
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
