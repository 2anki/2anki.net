import { Knex } from 'knex';
import NotionTokens from './public/NotionTokens';
import unHashToken from '../lib/misc/unHashToken';
import { NOTION_RECONNECT_NEEDED } from '../lib/ankify/notionReconnectNeeded';

// Reconnecting Notion resumes the syncs that were paused because Notion
// rejected the old connection, and only those.
export function buildResumePausedSyncsQuery(
  db: Knex,
  owner: number
): Knex.QueryBuilder {
  return db('ankify_notion_subscriptions')
    .where({ owner, enabled: false, last_error: NOTION_RECONNECT_NEEDED })
    .update({ enabled: true, last_error: null, updated_at: db.fn.now() });
}

export interface INotionRepository {
  getNotionData(owner: number | string): Promise<NotionTokens | null>;
  saveNotionToken(
    user: number,
    data: { [key: string]: string },
    hash: (token: string) => string
  ): Promise<boolean>;
  getNotionToken(owner: string): Promise<string | null>;
  deleteBlocksByOwner(owner: number): Promise<number>;
  deleteNotionData(owner: number): Promise<boolean>;
  markTokenInvalid(owner: number): Promise<void>;
  clearTokenInvalid(owner: number): Promise<void>;
  setReconnectEmailSent(owner: number): Promise<boolean>;
}

class NotionRepository implements INotionRepository {
  notionTokensTable = 'notion_tokens';

  notionBlocksTable = 'blocks';

  constructor(private readonly database: Knex) {}

  getNotionData(owner: number | string): Promise<NotionTokens | null> {
    if (!owner) {
      return Promise.resolve(null);
    }

    return this.database(this.notionTokensTable)
      .where({ owner: owner })
      .select('*')
      .first();
  }

  saveNotionToken(
    user: number,
    data: { [key: string]: string },
    hash: (token: string) => string
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.database(this.notionTokensTable)
        .insert({
          token_type: data.token_type,
          bot_id: data.bot_id,
          workspace_name: data.workspace_name,
          workspace_icon: data.workspace_icon,
          workspace_id: data.workspace_id,
          notion_owner: data.owner, // This actually JSON blob from Notion and not related to our owner id
          token: hash(data.access_token),
          owner: user,
          invalidated_at: null,
          reconnect_email_sent_at: null,
        })
        .onConflict('owner')
        .merge()
        .then(async () => {
          try {
            await buildResumePausedSyncsQuery(this.database, user);
          } catch (error) {
            console.error('[notion] resuming paused syncs failed', error);
          }
        })
        .then(() => {
          resolve(true);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * Retrieve the users notion token.
   * If the user does not have a token, throws error.
   * The caller is expected to handle this error.
   *
   * @param owner user id
   * @returns unhashed token
   */
  async getNotionToken(owner: string): Promise<string | null> {
    if (owner == null) {
      console.warn('[NotionRepository] getNotionToken called with no owner');
      return null;
    }
    const row = await this.database('notion_tokens')
      .where({ owner })
      .select('token')
      .first();

    /**
     * The user can disconnect Notion at any point so we should not throw an error here.
     */
    if (!row) {
      return Promise.resolve(null);
    }

    return unHashToken(row.token);
  }

  deleteBlocksByOwner(owner: number): Promise<number> {
    return this.database(this.notionBlocksTable).del().where({ owner });
  }

  /**
   * Delete the users notion token when they disconnect
   */
  deleteNotionData(owner: number | string): Promise<boolean> {
    return this.database(this.notionTokensTable).where({ owner: owner }).del();
  }

  async markTokenInvalid(owner: number): Promise<void> {
    await this.database(this.notionTokensTable)
      .where({ owner })
      .update({ invalidated_at: this.database.fn.now() });
  }

  async clearTokenInvalid(owner: number): Promise<void> {
    await this.database(this.notionTokensTable)
      .where({ owner })
      .update({ invalidated_at: null, reconnect_email_sent_at: null });
  }

  async setReconnectEmailSent(owner: number): Promise<boolean> {
    const affected = await this.database(this.notionTokensTable)
      .where({ owner })
      .whereNull('reconnect_email_sent_at')
      .update({ reconnect_email_sent_at: this.database.fn.now() });
    return affected === 1;
  }
}

export default NotionRepository;
