import { isValidEmailShape } from './isValidEmailShape';

const MIN_MESSAGE_CHARS = 15;
export const CONTACT_ACK_COOLDOWN_MS = 60 * 60 * 1000;

// The ack goes to an unauthenticated, user-supplied address, so every gate
// here is backscatter prevention: a junk address would bounce and burn
// SendGrid reputation, a trivial message is a probe not a person, and a
// repeat submission inside the cooldown means the address already got its
// receipt this hour. The submission itself is saved and returns 200
// regardless — only the outbound ack is gated.
export function shouldSendContactAck(
  email: unknown,
  message: unknown,
  recentSubmissionsFromEmail: number
): boolean {
  if (!isValidEmailShape(email)) return false;
  if (typeof message !== 'string' || message.trim().length < MIN_MESSAGE_CHARS)
    return false;
  return recentSubmissionsFromEmail <= 1;
}
