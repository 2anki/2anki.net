import type { Knex } from 'knex';

export interface ConversationRow {
  id: number;
  user_id: number;
  title: string;
  draft_content: string | null;
  template_slug: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ConversationSummary {
  id: number;
  title: string;
  updated_at: Date;
}

export interface ConversationWithMessages {
  id: number;
  title: string;
  draft: string | null;
  templateSlug: string | null;
  created_at: Date;
  updated_at: Date;
  messages: Array<{
    id: number;
    role: 'user' | 'assistant';
    content: string;
    attachmentText: string | null;
    hadBinaryAttachments: boolean;
    created_at: Date;
  }>;
}

export interface IConversationsRepository {
  create(input: { userId: number; title: string }): Promise<number>;
  listForUser(userId: number): Promise<ConversationSummary[]>;
  findForUser(input: {
    userId: number;
    conversationId: number;
  }): Promise<ConversationWithMessages | null>;
  rename(input: {
    userId: number;
    conversationId: number;
    title: string;
  }): Promise<boolean>;
  softDelete(input: {
    userId: number;
    conversationId: number;
  }): Promise<boolean>;
  deleteAllForUser(userId: number): Promise<number>;
  touch(input: { userId: number; conversationId: number }): Promise<void>;
  saveDraft(input: {
    userId: number;
    conversationId: number;
    content: string | null;
  }): Promise<boolean>;
  saveTemplate(input: {
    userId: number;
    conversationId: number;
    templateSlug: string | null;
  }): Promise<boolean>;
}

export class ConversationsRepository implements IConversationsRepository {
  private readonly table = 'conversations';

  constructor(private readonly database: Knex) {}

  async create(input: { userId: number; title: string }): Promise<number> {
    const [row] = await this.database(this.table)
      .insert({ user_id: input.userId, title: input.title })
      .returning<{ id: number }[]>('id');
    return row.id;
  }

  async listForUser(userId: number): Promise<ConversationSummary[]> {
    const rows = await this.database(this.table)
      .select('id', 'title', 'updated_at')
      .where('user_id', userId)
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc');
    return rows.map((r) => ({
      id: r.id as number,
      title: r.title as string,
      updated_at: r.updated_at as Date,
    }));
  }

  async findForUser(input: {
    userId: number;
    conversationId: number;
  }): Promise<ConversationWithMessages | null> {
    const conv = await this.database(this.table)
      .where({ id: input.conversationId, user_id: input.userId })
      .whereNull('deleted_at')
      .first<ConversationRow | undefined>();
    if (conv == null) return null;

    const rows = await this.database('chat_messages')
      .where({ conversation_id: input.conversationId, user_id: input.userId })
      .orderBy('created_at', 'asc')
      .select<
        {
          id: number;
          role: 'user' | 'assistant';
          content: string;
          attachment_text: string | null;
          had_binary_attachments: boolean;
          created_at: Date;
        }[]
      >(
        'id',
        'role',
        'content',
        'attachment_text',
        'had_binary_attachments',
        'created_at'
      );

    return {
      id: conv.id,
      title: conv.title,
      draft: conv.draft_content ?? null,
      templateSlug: conv.template_slug ?? null,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachmentText: m.attachment_text,
        hadBinaryAttachments: m.had_binary_attachments,
        created_at: m.created_at,
      })),
    };
  }

  async rename(input: {
    userId: number;
    conversationId: number;
    title: string;
  }): Promise<boolean> {
    const updated = await this.database(this.table)
      .where({ id: input.conversationId, user_id: input.userId })
      .whereNull('deleted_at')
      .update({ title: input.title, updated_at: this.database.fn.now() });
    return updated > 0;
  }

  async saveTemplate(input: {
    userId: number;
    conversationId: number;
    templateSlug: string | null;
  }): Promise<boolean> {
    const updated = await this.database(this.table)
      .where({ id: input.conversationId, user_id: input.userId })
      .whereNull('deleted_at')
      .update({ template_slug: input.templateSlug });
    return updated > 0;
  }

  async softDelete(input: {
    userId: number;
    conversationId: number;
  }): Promise<boolean> {
    const updated = await this.database(this.table)
      .where({ id: input.conversationId, user_id: input.userId })
      .whereNull('deleted_at')
      .update({ deleted_at: this.database.fn.now() });
    return updated > 0;
  }

  // Hard delete, soft-deleted rows included — "delete all" is the purge path,
  // so nothing may survive for the user, not even already-hidden rows.
  async deleteAllForUser(userId: number): Promise<number> {
    return this.database(this.table).where({ user_id: userId }).del();
  }

  async touch(input: {
    userId: number;
    conversationId: number;
  }): Promise<void> {
    await this.database(this.table)
      .where({ id: input.conversationId, user_id: input.userId })
      .whereNull('deleted_at')
      .update({ updated_at: this.database.fn.now() });
  }

  async saveDraft(input: {
    userId: number;
    conversationId: number;
    content: string | null;
  }): Promise<boolean> {
    const updated = await this.database(this.table)
      .where({ id: input.conversationId, user_id: input.userId })
      .whereNull('deleted_at')
      .update({ draft_content: input.content });
    return updated > 0;
  }
}

export class InMemoryConversationsRepository implements IConversationsRepository {
  private readonly rows: ConversationRow[] = [];
  private readonly messages: Array<{
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
  private nextMessageId = 1;

  async create(input: { userId: number; title: string }): Promise<number> {
    const now = new Date();
    const id = this.nextId++;
    this.rows.push({
      id,
      user_id: input.userId,
      title: input.title,
      draft_content: null,
      template_slug: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    return id;
  }

  async listForUser(userId: number): Promise<ConversationSummary[]> {
    return this.rows
      .filter((r) => r.user_id === userId && r.deleted_at == null)
      .sort((a, b) => {
        const t = b.updated_at.getTime() - a.updated_at.getTime();
        return t !== 0 ? t : b.id - a.id;
      })
      .map((r) => ({ id: r.id, title: r.title, updated_at: r.updated_at }));
  }

  async findForUser(input: {
    userId: number;
    conversationId: number;
  }): Promise<ConversationWithMessages | null> {
    const conv = this.rows.find(
      (r) =>
        r.id === input.conversationId &&
        r.user_id === input.userId &&
        r.deleted_at == null
    );
    if (conv == null) return null;
    const messages = this.messages
      .filter(
        (m) =>
          m.conversation_id === input.conversationId &&
          m.user_id === input.userId
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachmentText: m.attachment_text,
        hadBinaryAttachments: m.had_binary_attachments,
        created_at: m.created_at,
      }));
    return {
      id: conv.id,
      title: conv.title,
      draft: conv.draft_content ?? null,
      templateSlug: conv.template_slug ?? null,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      messages,
    };
  }

  async rename(input: {
    userId: number;
    conversationId: number;
    title: string;
  }): Promise<boolean> {
    const conv = this.rows.find(
      (r) =>
        r.id === input.conversationId &&
        r.user_id === input.userId &&
        r.deleted_at == null
    );
    if (conv == null) return false;
    conv.title = input.title;
    conv.updated_at = new Date();
    return true;
  }

  async softDelete(input: {
    userId: number;
    conversationId: number;
  }): Promise<boolean> {
    const conv = this.rows.find(
      (r) =>
        r.id === input.conversationId &&
        r.user_id === input.userId &&
        r.deleted_at == null
    );
    if (conv == null) return false;
    conv.deleted_at = new Date();
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

  async touch(input: {
    userId: number;
    conversationId: number;
  }): Promise<void> {
    const conv = this.rows.find(
      (r) =>
        r.id === input.conversationId &&
        r.user_id === input.userId &&
        r.deleted_at == null
    );
    if (conv != null) conv.updated_at = new Date();
  }

  async saveDraft(input: {
    userId: number;
    conversationId: number;
    content: string | null;
  }): Promise<boolean> {
    const conv = this.rows.find(
      (r) =>
        r.id === input.conversationId &&
        r.user_id === input.userId &&
        r.deleted_at == null
    );
    if (conv == null) return false;
    conv.draft_content = input.content;
    return true;
  }

  async saveTemplate(input: {
    userId: number;
    conversationId: number;
    templateSlug: string | null;
  }): Promise<boolean> {
    const conv = this.rows.find(
      (r) =>
        r.id === input.conversationId &&
        r.user_id === input.userId &&
        r.deleted_at == null
    );
    if (conv == null) return false;
    conv.template_slug = input.templateSlug;
    return true;
  }

  recordMessage(entry: {
    userId: number;
    conversationId: number | null;
    role: 'user' | 'assistant';
    content: string;
    attachmentText?: string | null;
    hadBinaryAttachments?: boolean;
  }): void {
    this.messages.push({
      id: this.nextMessageId++,
      user_id: entry.userId,
      conversation_id: entry.conversationId,
      role: entry.role,
      content: entry.content,
      attachment_text: entry.attachmentText ?? null,
      had_binary_attachments: entry.hadBinaryAttachments ?? false,
      created_at: new Date(),
    });
  }
}
