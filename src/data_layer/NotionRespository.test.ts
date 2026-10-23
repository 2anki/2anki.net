import knexLib from 'knex';

import { buildResumePausedSyncsQuery } from './NotionRespository';

describe('buildResumePausedSyncsQuery', () => {
  it('resumes only the owner syncs paused for the dead Notion connection', () => {
    const sql = buildResumePausedSyncsQuery(
      knexLib({ client: 'pg' }),
      42
    ).toString();

    expect(sql).toContain('update "ankify_notion_subscriptions"');
    expect(sql).toContain('"enabled" = true');
    expect(sql).toContain('"last_error" = NULL');
    expect(sql).toContain(
      'where "owner" = 42 and "enabled" = false and "last_error" = \'notion_reconnect_needed\''
    );
  });
});
