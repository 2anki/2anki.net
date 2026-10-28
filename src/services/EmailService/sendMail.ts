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

export function toEmailSendError(error: unknown): EmailSendError {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return new EmailSendError(
    error instanceof Error ? error.message : 'email send failed',
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
