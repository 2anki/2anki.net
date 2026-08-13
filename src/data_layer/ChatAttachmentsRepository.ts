import type { Knex } from 'knex';

export interface ChatAttachmentRecord {
  messageId: number;
  s3Key: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

export interface ChatAttachmentInsert {
  userId: number;
  messageId: number;
  s3Key: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

export interface IChatAttachmentsRepository {
  insertMany(entries: ChatAttachmentInsert[]): Promise<void>;
  listForMessage(input: {
    userId: number;
    messageId: number;
  }): Promise<ChatAttachmentRecord[]>;
  deleteForMessage(input: {
    userId: number;
    messageId: number;
  }): Promise<number>;
  deleteForConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<number>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export class ChatAttachmentsRepository implements IChatAttachmentsRepository {
  private readonly table = 'chat_attachments';

  constructor(private readonly database: Knex) {}

  async insertMany(entries: ChatAttachmentInsert[]): Promise<void> {
    if (entries.length === 0) return;
    await this.database(this.table).insert(
      entries.map((entry) => ({
        user_id: entry.userId,
        message_id: entry.messageId,
        s3_key: entry.s3Key,
        filename: entry.filename,
        content_type: entry.contentType,
        byte_size: entry.byteSize,
      }))
    );
  }

  async listForMessage(input: {
    userId: number;
    messageId: number;
  }): Promise<ChatAttachmentRecord[]> {
    const rows = await this.database(this.table)
      .where({ user_id: input.userId, message_id: input.messageId })
      .orderBy('id', 'asc')
      .select<
        {
          message_id: number;
          s3_key: string;
          filename: string;
          content_type: string;
          byte_size: number;
        }[]
      >('message_id', 's3_key', 'filename', 'content_type', 'byte_size');
    return rows.map((row) => ({
      messageId: row.message_id,
      s3Key: row.s3_key,
      filename: row.filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
    }));
  }

  async deleteForMessage(input: {
    userId: number;
    messageId: number;
  }): Promise<number> {
    return this.database(this.table)
      .where({ user_id: input.userId, message_id: input.messageId })
      .del();
  }

  async deleteForConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<number> {
    return this.database(this.table)
      .where({ user_id: input.userId })
      .whereIn(
        'message_id',
        this.database('chat_messages').select('id').where({
          user_id: input.userId,
          conversation_id: input.conversationId,
        })
      )
      .del();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return this.database(this.table).where('created_at', '<', cutoff).del();
  }
}

export class InMemoryChatAttachmentsRepository implements IChatAttachmentsRepository {
  readonly rows: Array<ChatAttachmentInsert & { createdAt: Date }> = [];
  messageConversations = new Map<number, number>();

  async insertMany(entries: ChatAttachmentInsert[]): Promise<void> {
    for (const entry of entries) {
      this.rows.push({ ...entry, createdAt: new Date() });
    }
  }

  async listForMessage(input: {
    userId: number;
    messageId: number;
  }): Promise<ChatAttachmentRecord[]> {
    return this.rows
      .filter(
        (row) =>
          row.userId === input.userId && row.messageId === input.messageId
      )
      .map((row) => ({
        messageId: row.messageId,
        s3Key: row.s3Key,
        filename: row.filename,
        contentType: row.contentType,
        byteSize: row.byteSize,
      }));
  }

  async deleteForMessage(input: {
    userId: number;
    messageId: number;
  }): Promise<number> {
    return this.remove(
      (row) => row.userId === input.userId && row.messageId === input.messageId
    );
  }

  async deleteForConversation(input: {
    userId: number;
    conversationId: number;
  }): Promise<number> {
    return this.remove(
      (row) =>
        row.userId === input.userId &&
        this.messageConversations.get(row.messageId) === input.conversationId
    );
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return this.remove((row) => row.createdAt < cutoff);
  }

  private remove(
    predicate: (row: ChatAttachmentInsert & { createdAt: Date }) => boolean
  ): number {
    let removed = 0;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (predicate(this.rows[i])) {
        this.rows.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}
