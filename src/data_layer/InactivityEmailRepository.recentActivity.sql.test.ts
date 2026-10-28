import knexFactory from 'knex';

import { InactivityEmailRepository } from './InactivityEmailRepository';

describe('InactivityEmailRepository recent activity SQL', () => {
  const pg = knexFactory({ client: 'pg' });
  const repository = new InactivityEmailRepository(pg);
  const sixMonthsAgo = "now() - interval '6 months'";

  afterAll(async () => {
    await pg.destroy();
  });

  it.each([
    [
      'warning',
      () => repository.buildUsersToNotifyQuery(500).toString(),
      'users.id',
      sixMonthsAgo,
    ],
    [
      'deletion after a warning',
      () => repository.buildUsersToDeleteQuery(100).toString(),
      'u.id',
      'ie.sent_at',
    ],
    [
      'dead-address deletion',
      () => repository.buildDeadAddressCandidatesQuery(100).toString(),
      'u.id',
      sixMonthsAgo,
    ],
  ])(
    'spares a user from %s who saved a deck, connected the MCP connector or called an MCP tool since',
    (_label, buildSql, userId, since) => {
      const sql = buildSql();

      expect(sql).toContain(
        `not exists (select * from "uploads" where uploads.owner = ${userId} and uploads.created_at > ${since} limit 1)`
      );
      expect(sql).toContain(
        `not exists (select * from "mcp_refresh_tokens" where mcp_refresh_tokens.user_id = ${userId} and mcp_refresh_tokens.created_at > ${since} limit 1)`
      );
      expect(sql).toContain(
        `not exists (select * from "events" where "events"."name" = 'mcp_tool_called' and events.user_id = ${userId} and events.created_at > ${since} limit 1)`
      );
    }
  );
});
