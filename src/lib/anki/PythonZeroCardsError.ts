import { inspect, type InspectOptions } from 'node:util';
import { scrubPythonRawOutputTail } from './redactPythonOutput';

export const PYTHON_NO_CARDS_SENTINEL = 'No cards generated';

// A sync upload shows this message as is, so it is written for the person.
export const PYTHON_ZERO_CARDS_MESSAGE =
  'No cards came out of this file. Give each question an answer, then convert again.';

// The upload worker serialises errors as { message, name } and rebuilds a plain
// Error, so the name is the only thing that survives to jobFailureReason. The
// writer's output can name the user's cards or files, so it stays out of the
// message and off the enumerable fields; inspect shows only a redacted tail.
export class PythonZeroCardsError extends Error {
  declare readonly rawOutput: string;

  constructor(stdout: string) {
    super(PYTHON_ZERO_CARDS_MESSAGE);
    this.name = 'PythonZeroCardsError';
    Object.defineProperty(this, 'rawOutput', {
      value: stdout,
      enumerable: false,
    });
  }

  [inspect.custom](
    _depth: number,
    options: InspectOptions,
    inspectNested: typeof inspect
  ): string {
    const details = { output: scrubPythonRawOutputTail(this.rawOutput) };
    return `${this.stack ?? `${this.name}: ${this.message}`} ${inspectNested(details, options)}`;
  }
}
