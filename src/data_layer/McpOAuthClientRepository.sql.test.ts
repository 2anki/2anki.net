import knex from 'knex';

import { McpOAuthClientRepository } from './McpOAuthClientRepository';

describe('McpOAuthClientRepository deleteOrphaned generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new McpOAuthClientRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('deletes clients issued before the cutoff with no codes or tokens', () => {
    const issuedBefore = 1_700_000_000;
    const { sql, bindings } = repository
      .buildDeleteOrphanedQuery(issuedBefore)
      .toSQL();

    expect(sql).toBe(
      'delete from "mcp_oauth_clients" where "client_id_issued_at" < ? ' +
        'and not exists ' +
        '(select 1 from "mcp_authorization_codes" ' +
        'where mcp_authorization_codes.client_id = mcp_oauth_clients.client_id) ' +
        'and not exists ' +
        '(select 1 from "mcp_access_tokens" ' +
        'where mcp_access_tokens.client_id = mcp_oauth_clients.client_id) ' +
        'and not exists ' +
        '(select 1 from "mcp_refresh_tokens" ' +
        'where mcp_refresh_tokens.client_id = mcp_oauth_clients.client_id)'
    );
    expect(bindings).toEqual([issuedBefore]);
  });

  it('upserts a client row by client_id, refreshing its metadata', () => {
    const { sql, bindings } = repository
      .buildUpsertQuery({
        client_id: 'cimd_abc',
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/cb'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: null,
        token_endpoint_auth_method: 'none',
        metadata: { client_id_metadata_document: 'https://claude.ai/doc' },
        client_id_issued_at: 1_700_000_000,
      })
      .toSQL();

    expect(sql).toMatch(/^insert into "mcp_oauth_clients" /);
    expect(sql).toContain(
      'on conflict ("client_id") do update set ' +
        '"client_name" = excluded."client_name", ' +
        '"redirect_uris" = excluded."redirect_uris", ' +
        '"grant_types" = excluded."grant_types", ' +
        '"response_types" = excluded."response_types", ' +
        '"scope" = excluded."scope", ' +
        '"metadata" = excluded."metadata", ' +
        '"client_id_issued_at" = excluded."client_id_issued_at"'
    );
    expect(bindings).toContain('cimd_abc');
    expect(bindings).toContain('["https://claude.ai/cb"]');
  });
});
