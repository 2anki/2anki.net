import { getSafeFilename } from '../getSafeFilename';

export const CHAT_ATTACHMENTS_PREFIX = 'chat-attachments/';
export const CHAT_ATTACHMENT_RETENTION_DAYS = 90;

export function chatAttachmentsUserPrefix(userId: number): string {
  return `${CHAT_ATTACHMENTS_PREFIX}${userId}/`;
}

export function chatAttachmentsConversationPrefix(
  userId: number,
  conversationId: number
): string {
  return `${chatAttachmentsUserPrefix(userId)}${conversationId}/`;
}

export function chatAttachmentKey(input: {
  userId: number;
  conversationId: number;
  messageId: number;
  index: number;
  filename: string;
}): string {
  const safeName = getSafeFilename(input.filename);
  return `${chatAttachmentsConversationPrefix(input.userId, input.conversationId)}${input.messageId}/${input.index}-${safeName}`;
}

export function chatAttachmentRetentionCutoff(now: Date = new Date()): Date {
  return new Date(
    now.getTime() - CHAT_ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
}
