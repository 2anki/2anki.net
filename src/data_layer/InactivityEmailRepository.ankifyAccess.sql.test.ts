import knexFactory from 'knex';

import { InactivityEmailRepository } from './InactivityEmailRepository';

describe('InactivityEmailRepository Auto Sync comp exemption SQL', () => {
  const pg = knexFactory({ client: 'pg' });
  const repository = new InactivityEmailRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('never warns a user with an Auto Sync comp grant', () => {
    const sql = repository.buildUsersToNotifyQuery(500).toString();

    expect(sql).toContain('users.ankify_access IS NOT TRUE');
  });

  it('never deletes a warned user who has an Auto Sync comp grant', () => {
    const sql = repository.buildUsersToDeleteQuery(100).toString();

    expect(sql).toContain('u.ankify_access IS NOT TRUE');
  });

  it('never deletes a dead-address user who has an Auto Sync comp grant', () => {
    const sql = repository.buildDeadAddressCandidatesQuery(100).toString();

    expect(sql).toContain('u.ankify_access IS NOT TRUE');
  });
});
