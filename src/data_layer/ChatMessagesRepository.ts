import type { Knex } from 'knex';

export interface ChatMessageRow {
  id: number;
  user_id: number;
  conversation_id: number | null;
  role: 'user' | 'assistant';
  content: string;
  attachment_text: string | null;
  had_binary_attachments: boolean;
  created_at: Date;
}

export interface ChatMessageInsert {
  userId: number;
  conversationId: number | null;
  role: 'user' | 'assistant';
  content: string;
  attachmentText?: string | null;
  hadBinaryAttachments?: boolean;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  attachmentText: string | null;
}

export interface IChatMessagesRepository {
  insert(entry: ChatMessageInsert): Promise<number>;
  listForConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<ChatHistoryMessage[]>;
  findLatestAssistantInConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<{ id: number; content: string } | null>;
  updateContent(input: {
    userId: number;
    messageId: number;
    content: string;
  }): Promise<boolean>;
  deleteById(input: { userId: number; messageId: number }): Promise<boolean>;
  deleteAllForUser(userId: number): Promise<number>;
}

export class ChatMessagesRepository implements IChatMessagesRepository {
  private readonly table = 'chat_messages';

  constructor(private readonly database: Knex) {}

  async insert(entry: ChatMessageInsert): Promise<number> {
    const [row] = await this.database(this.table)
      .insert({
        user_id: entry.userId,
        conversation_id: entry.conversationId,
        role: entry.role,
        content: entry.content,
        attachment_text: entry.attachmentText ?? null,
        had_binary_attachments: entry.hadBinaryAttachments ?? false,
      })
      .returning<{ id: number }[]>('id');
    return row.id;
  }

  async listForConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<ChatHistoryMessage[]> {
    const rows = await this.database(this.table)
      .where({
        user_id: input.userId,
        conversation_id: input.conversationId,
      })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .select<
        {
          role: 'user' | 'assistant';
          content: string;
          attachment_text: string | null;
        }[]
      >('role', 'content', 'attachment_text');
    return rows.map((row) => ({
      role: row.role,
      content: row.content,
      attachmentText: row.attachment_text,
    }));
  }

  async findLatestAssistantInConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<{ id: number; content: string } | null> {
    const row = await this.database(this.table)
      .where({
        user_id: input.userId,
        conversation_id: input.conversationId,
        role: 'assistant',
      })
      .orderBy('created_at', 'desc')
      .first<{ id: number; content: string } | undefined>('id', 'content');
    return row ?? null;
  }

  async updateContent(input: {
    userId: number;
    messageId: number;
    content: string;
  }): Promise<boolean> {
    const updated = await this.database(this.table)
      .where({ id: input.messageId, user_id: input.userId })
      .update({ content: input.content });
    return updated > 0;
  }

  async deleteById(input: {
    userId: number;
    messageId: number;
  }): Promise<boolean> {
    const deleted = await this.database(this.table)
      .where({ id: input.messageId, user_id: input.userId })
      .del();
    return deleted > 0;
  }

  // By user_id, not via conversations: legacy messages predating the
  // conversations table carry conversation_id NULL and would survive a
  // conversation-scoped cascade. attachment_text holds users' document text,
  // so the purge must catch every row.
  async deleteAllForUser(userId: number): Promise<number> {
    return this.database(this.table).where({ user_id: userId }).del();
  }
}

export class InMemoryChatMessagesRepository implements IChatMessagesRepository {
  private readonly rows: Array<{
    id: number;
    user_id: number;
    conversation_id: number | null;
    role: 'user' | 'assistant';
    content: string;
    attachment_text: string | null;
    had_binary_attachments: boolean;
    created_at: Date;
  }> = [];
  private nextId = 1;

  async insert(entry: ChatMessageInsert): Promise<number> {
    const id = this.nextId++;
    this.rows.push({
      id,
      user_id: entry.userId,
      conversation_id: entry.conversationId,
      role: entry.role,
      content: entry.content,
      attachment_text: entry.attachmentText ?? null,
      had_binary_attachments: entry.hadBinaryAttachments ?? false,
      created_at: new Date(),
    });
    return id;
  }

  async listForConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<ChatHistoryMessage[]> {
    return this.rows
      .filter(
        (r) =>
          r.user_id === input.userId &&
          r.conversation_id === input.conversationId
      )
      .sort((a, b) => {
        const t = a.created_at.getTime() - b.created_at.getTime();
        return t === 0 ? a.id - b.id : t;
      })
      .map((r) => ({
        role: r.role,
        content: r.content,
        attachmentText: r.attachment_text,
      }));
  }

  async findLatestAssistantInConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<{ id: number; content: string } | null> {
    const matching = this.rows.filter(
      (r) =>
        r.user_id === input.userId &&
        r.conversation_id === input.conversationId &&
        r.role === 'assistant'
    );
    if (matching.length === 0) return null;
    matching.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { id: matching[0].id, content: matching[0].content };
  }

  async updateContent(input: {
    userId: number;
    messageId: number;
    content: string;
  }): Promise<boolean> {
    const row = this.rows.find(
      (r) => r.id === input.messageId && r.user_id === input.userId
    );
    if (row == null) return false;
    row.content = input.content;
    return true;
  }

  async deleteById(input: {
    userId: number;
    messageId: number;
  }): Promise<boolean> {
    const index = this.rows.findIndex(
      (r) => r.id === input.messageId && r.user_id === input.userId
    );
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async deleteAllForUser(userId: number): Promise<number> {
    let removed = 0;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].user_id === userId) {
        this.rows.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  getAll(): typeof this.rows {
    return this.rows;
  }
}
