export const RECOVERY_TOO_LARGE_MESSAGE =
  'This upload is too large to process. Split it into smaller uploads and try again.';

// The name is what survives the upload worker's thread boundary, so
// jobFailureReason and isExpectedUploadState match on it, not the class.
export class ZipRecoveryTooLargeError extends Error {
  constructor() {
    super(RECOVERY_TOO_LARGE_MESSAGE);
    this.name = 'ZipRecoveryTooLargeError';
  }
}
