// Errors that are the client's fault and fully handled by ErrorHandler as a
// 4xx — not bugs to investigate. Logging a full stack for these floods the
// server logs and buries real crashes. Mirrors the dashboard skip in
// ErrorCaptureMiddleware (entity.parse.failed) and extends it to the expected
// upload-shape errors that resolve to a clean 400.
const isClientAbort = (error: Error): boolean => {
  const code = (error as { code?: string }).code;
  const type = (error as { type?: string }).type;
  return (
    error.message === 'Request aborted' ||
    type === 'request.aborted' ||
    code === 'ECONNABORTED' ||
    code === 'ECONNRESET'
  );
};

export const isExpectedClientFault = (error?: Error): boolean => {
  if (!error) {
    return false;
  }
  if ((error as { type?: string }).type === 'entity.parse.failed') {
    return true;
  }
  if (isClientAbort(error)) {
    return true;
  }
  // Every multer error is the request's fault (too large, wrong field,
  // too many files) and ErrorHandler maps each to a clean 4xx — recording
  // them as server errors buries real crashes in the dashboard.
  if (error.name === 'MulterError') {
    return true;
  }
  return error.name === 'AnkiAppExportError';
};
