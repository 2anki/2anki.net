import { isWorkerTerminationError } from './workerTermination';

describe('isWorkerTerminationError', () => {
  it('matches the pool force-drain rejection', () => {
    expect(
      isWorkerTerminationError(new Error('Terminating worker thread'))
    ).toBe(true);
  });

  it('does not match other errors or non-errors', () => {
    expect(isWorkerTerminationError(new Error('ECONNRESET'))).toBe(false);
    expect(isWorkerTerminationError('Terminating worker thread')).toBe(false);
    expect(isWorkerTerminationError(undefined)).toBe(false);
  });
});
