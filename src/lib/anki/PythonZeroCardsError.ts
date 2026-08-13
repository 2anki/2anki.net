export const PYTHON_NO_CARDS_SENTINEL = 'No cards generated';

// The upload worker serialises errors as { message, name } and rebuilds a plain
// Error, so the name is the only thing that survives to jobFailureReason.
export class PythonZeroCardsError extends Error {
  constructor(stdout: string) {
    super(`Python built zero cards. stdout: ${stdout || '(empty)'}`);
    this.name = 'PythonZeroCardsError';
  }
}
