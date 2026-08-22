/**
 * Base class for deliberate HTTP-mapped errors. A use case throws a subclass
 * with the status and machine-readable code it wants on the wire; the error
 * funnel (ErrorHandler) turns it into `res.status(status).json({code,
 * message})` so controllers can `next(err)`/rethrow instead of duplicating
 * instanceof→status maps. Statuses below 500 are treated as expected client
 * faults: no error email, no error_events row, no stack in the logs.
 */
export class HttpCodedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export function isHttpCodedClientFault(error: Error): boolean {
  return error instanceof HttpCodedError && error.status < 500;
}
