import knex from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository reset-token generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UsersRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('only redeems a token that is unexpired and unused', () => {
    const { sql } = repository
      .buildUpdatePasswordQuery('hashed', 'raw-token')
      .toSQL();

    expect(sql).toContain('"reset_token" = ?');
    expect(sql).toContain('"reset_token_expires_at" > ');
    expect(sql).toContain('"reset_token_used_at" is null');
  });

  it('marks the token used and clears it when redeemed', () => {
    const { sql } = repository
      .buildUpdatePasswordQuery('hashed', 'raw-token')
      .toSQL();

    expect(sql).toContain('"password" = ?');
    expect(sql).toContain('"reset_token" = ?');
    expect(sql).toContain('"reset_token_used_at" =');
  });

  it('stamps an expiry when a reset token is issued', () => {
    const expiresAt = new Date('2026-07-27T12:15:00.000Z');
    const { sql, bindings } = repository
      .buildUpdateResetTokenQuery('42', 'raw-token', expiresAt)
      .toSQL();

    expect(sql).toContain('"reset_token_expires_at" = ?');
    expect(bindings).toContain(expiresAt);
  });
});
