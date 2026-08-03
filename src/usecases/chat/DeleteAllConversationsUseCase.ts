import type { IConversationsRepository } from '../../data_layer/ConversationsRepository';
import type { IChatMessagesRepository } from '../../data_layer/ChatMessagesRepository';

export class DeleteAllConversationsUseCase {
  constructor(
    private readonly conversations: IConversationsRepository,
    private readonly messages: IChatMessagesRepository
  ) {}

  // Messages go first so a failure between the two deletes leaves recoverable
  // state: conversations without messages retry cleanly, while messages
  // without conversations would leak the attachment text this purge exists
  // to remove.
  async execute(userId: number): Promise<number> {
    await this.messages.deleteAllForUser(userId);
    return this.conversations.deleteAllForUser(userId);
  }
}
