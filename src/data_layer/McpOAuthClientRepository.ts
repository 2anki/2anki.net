import type { Knex } from 'knex';
import type McpOauthClients from './public/McpOauthClients';

export interface StoredMcpClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string | null;
  token_endpoint_auth_method: string;
  metadata: Record<string, unknown>;
  client_id_issued_at: number;
}

export interface IMcpOAuthClientRepository {
  create(client: StoredMcpClient): Promise<StoredMcpClient>;
  upsert(client: StoredMcpClient): Promise<void>;
  findById(clientId: string): Promise<StoredMcpClient | null>;
  deleteOrphaned(issuedBeforeUnixSeconds: number): Promise<number>;
}

function toStored(row: McpOauthClients): StoredMcpClient {
  return {
    client_id: row.client_id,
    client_name: row.client_name,
    redirect_uris: row.redirect_uris as string[],
    grant_types: row.grant_types as string[],
    response_types: row.response_types as string[],
    scope: row.scope,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    metadata: row.metadata as Record<string, unknown>,
    client_id_issued_at: Number(row.client_id_issued_at),
  };
}

export class McpOAuthClientRepository implements IMcpOAuthClientRepository {
  private readonly table = 'mcp_oauth_clients';

  constructor(private readonly database: Knex) {}

  async create(client: StoredMcpClient): Promise<StoredMcpClient> {
    const [row] = await this.database(this.table)
      .insert({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: JSON.stringify(client.redirect_uris),
        grant_types: JSON.stringify(client.grant_types),
        response_types: JSON.stringify(client.response_types),
        scope: client.scope,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        metadata: JSON.stringify(client.metadata),
        client_id_issued_at: client.client_id_issued_at,
      })
      .returning('*');
    return toStored(row as McpOauthClients);
  }

  buildUpsertQuery(client: StoredMcpClient): Knex.QueryBuilder {
    return this.database(this.table)
      .insert({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: JSON.stringify(client.redirect_uris),
        grant_types: JSON.stringify(client.grant_types),
        response_types: JSON.stringify(client.response_types),
        scope: client.scope,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        metadata: JSON.stringify(client.metadata),
        client_id_issued_at: client.client_id_issued_at,
      })
      .onConflict('client_id')
      .merge([
        'client_name',
        'redirect_uris',
        'grant_types',
        'response_types',
        'scope',
        'metadata',
        'client_id_issued_at',
      ]);
  }

  async upsert(client: StoredMcpClient): Promise<void> {
    await this.buildUpsertQuery(client);
  }

  async findById(clientId: string): Promise<StoredMcpClient | null> {
    const row = (await this.database(this.table)
      .where({ client_id: clientId })
      .first()) as McpOauthClients | undefined;
    return row == null ? null : toStored(row);
  }

  buildDeleteOrphanedQuery(issuedBeforeUnixSeconds: number): Knex.QueryBuilder {
    return this.database(this.table)
      .where('client_id_issued_at', '<', issuedBeforeUnixSeconds)
      .whereNotExists((qb) =>
        qb
          .select(1)
          .from('mcp_authorization_codes')
          .whereRaw(
            'mcp_authorization_codes.client_id = mcp_oauth_clients.client_id'
          )
      )
      .whereNotExists((qb) =>
        qb
          .select(1)
          .from('mcp_access_tokens')
          .whereRaw('mcp_access_tokens.client_id = mcp_oauth_clients.client_id')
      )
      .whereNotExists((qb) =>
        qb
          .select(1)
          .from('mcp_refresh_tokens')
          .whereRaw(
            'mcp_refresh_tokens.client_id = mcp_oauth_clients.client_id'
          )
      )
      .del();
  }

  async deleteOrphaned(issuedBeforeUnixSeconds: number): Promise<number> {
    return this.buildDeleteOrphanedQuery(issuedBeforeUnixSeconds);
  }
}
