import sgMail from '@sendgrid/mail';

// On a transport failure SendGrid rejects with the raw axios error, whose
// request config holds the API key (Authorization header) and the recipient
// (body). Callers log what they catch, so only the code and message get out.
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly code?: string | number
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

interface SendGridFailure {
  code?: unknown;
  response?: { body?: { errors?: { message?: unknown }[] } };
}

// A 4xx carries SendGrid's own reason ("from address does not match a
// verified Sender Identity") in the response body. It holds neither the key
// nor the request, and without it a rejection logs only "Forbidden".
function sendGridReasons(error: SendGridFailure): string[] {
  const errors = error.response?.body?.errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors
    .map((entry) => entry?.message)
    .filter((message): message is string => typeof message === 'string');
}

export function toEmailSendError(error: unknown): EmailSendError {
  const failure = (error ?? {}) as SendGridFailure;
  const base = error instanceof Error ? error.message : 'email send failed';
  const reasons = sendGridReasons(failure);
  const code = failure.code;
  return new EmailSendError(
    reasons.length > 0 ? `${base}: ${reasons.join('; ')}` : base,
    typeof code === 'string' || typeof code === 'number' ? code : undefined
  );
}

export async function sendMail(
  msg: Parameters<typeof sgMail.send>[0]
): ReturnType<typeof sgMail.send> {
  try {
    return await sgMail.send(msg);
  } catch (error) {
    throw toEmailSendError(error);
  }
}
