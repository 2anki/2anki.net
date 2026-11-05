import { PythonExitError } from './buildPythonExitError';
import { scrubPythonRawOutput } from './redactPythonOutput';

export function buildUnknownPythonErrorContext(
  err: Error
): Record<string, unknown> | null {
  if (
    err instanceof PythonExitError &&
    err.kind === 'unknown' &&
    err.rawOutput !== ''
  ) {
    return {
      python_crash_kind: err.kind,
      python_exit_code: err.code,
      python_raw_output: scrubPythonRawOutput(err.rawOutput),
    };
  }
  return null;
}
