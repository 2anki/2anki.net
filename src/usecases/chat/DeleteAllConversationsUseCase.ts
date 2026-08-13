import type { IConversationsRepository } from '../../data_layer/ConversationsRepository';
import type { IChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';
import { chatAttachmentsUserPrefix } from '../../lib/storage/chatAttachmentKeys';
import type { IChatAttachmentPrefixStorage } from './ConversationsUseCase';

export class DeleteAllConversationsUseCase {
  constructor(
    private readonly conversations: IConversationsRepository,
    private readonly messages: IChatMessagesRepository,
    private readonly storage?: IChatAttachmentPrefixStorage
  ) {}

  // Messages go first so a failure between the two deletes leaves recoverable
  // state: conversations without messages retry cleanly, while messages
  // without conversations would leak the attachment text this purge exists
  // to remove. Attachment rows ride the message-delete FK cascade; the
  // objects go via the prefix sweep, best-effort because the bucket
  // lifecycle rule reaps anything a failed sweep leaves behind.
  async execute(userId: number): Promise<number> {
    try {
      await this.storage?.deleteByPrefix(chatAttachmentsUserPrefix(userId));
    } catch (error) {
      console.error('[chat] attachment sweep failed for delete-all', error);
    }
    await this.messages.deleteAllForUser(userId);
    return this.conversations.deleteAllForUser(userId);
  }
}
