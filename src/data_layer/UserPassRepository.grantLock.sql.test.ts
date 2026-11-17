import knex from 'knex';
import { ADVISORY_LOCK_NAMESPACES } from './JobLockRepository';
import { UserPassRepository } from './UserPassRepository';

const NOW = new Date('2030-01-01T12:00:00.000Z');
const DURATION_7D = 7 * 24 * 60 * 60 * 1000;
const LOCK_SQL = 'select pg_advisory_xact_lock($1, $2)';

interface IssuedStatement {
  connection: number;
  sql: string;
  bindings: unknown[];
}

interface PgResponse {
  command: string;
  rows: unknown[];
}

type Responder = (sql: string) => PgResponse | Error;

const selectNothing = (): PgResponse => ({ command: 'SELECT', rows: [] });

function passRow(userId: number, intent: string, expiresAt: Date) {
  return {
    id: 7,
    user_id: userId,
    kind: '7d',
    expires_at: expiresAt,
    stripe_payment_intent_id: intent,
  };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key'), { code: '23505' });
}

function insertAnswers(userId: number, intent: string): Responder {
  return (sql) => {
    if (sql.startsWith('insert')) {
      return {
        command: 'INSERT',
        rows: [passRow(userId, intent, new Date(NOW.getTime() + DURATION_7D))],
      };
    }
    return selectNothing();
  };
}

function recordingDatabase(respond: Responder) {
  const database = knex({ client: 'pg' });
  const issued: IssuedStatement[] = [];
  const released: number[] = [];
  let nextConnection = 1;

  Object.assign(database.client, {
    acquireConnection: async () => {
      const connection = nextConnection++;
      return {
        connection,
        query(
          config: { text: string; values: unknown[] },
          callback: (err: Error | null, response?: PgResponse) => void
        ) {
          issued.push({
            connection,
            sql: config.text,
            bindings: config.values,
          });
          const outcome = respond(config.text);
          if (outcome instanceof Error) {
            callback(outcome);
          } else {
            callback(null, outcome);
          }
        },
      };
    },
    releaseConnection: async (raw: { connection: number }) => {
      released.push(raw.connection);
    },
  });

  return { database, issued, released };
}

describe('UserPassRepository.upsertWithExtension — locked grant SQL', () => {
  it('takes the per-user lock, reads and inserts on one transaction, in that order', async () => {
    const { database, issued } = recordingDatabase(insertAnswers(42, 'pi_new'));

    await new UserPassRepository(database).upsertWithExtension(
      42,
      '7d',
      DURATION_7D,
      'pi_new',
      NOW
    );

    expect(
      issued.map(({ sql }) => sql.split(' ').slice(0, 3).join(' '))
    ).toEqual([
      'BEGIN;',
      'select pg_advisory_xact_lock($1, $2)',
      'select * from',
      'select * from',
      'insert into "user_passes"',
      'COMMIT;',
    ]);
    expect(new Set(issued.map(({ connection }) => connection)).size).toBe(1);
    expect(issued[1]).toMatchObject({
      sql: LOCK_SQL,
      bindings: [ADVISORY_LOCK_NAMESPACES.userPassGrants, 42],
    });
    expect(issued[2].sql).toContain('"stripe_payment_intent_id" = $1');
    expect(issued[3].sql).toContain('"user_id" = $1 and "expires_at" > $2');
    expect(issued[3].sql).toContain('order by "expires_at" desc');
  });

  it('keys the lock on the user, so two users take different locks', async () => {
    const first = recordingDatabase(insertAnswers(1, 'pi_a'));
    const second = recordingDatabase(insertAnswers(2, 'pi_b'));

    await new UserPassRepository(first.database).upsertWithExtension(
      1,
      '7d',
      DURATION_7D,
      'pi_a',
      NOW
    );
    await new UserPassRepository(second.database).upsertWithExtension(
      2,
      '7d',
      DURATION_7D,
      'pi_b',
      NOW
    );

    const lockBindings = (issued: IssuedStatement[]) =>
      issued.find(({ sql }) => sql === LOCK_SQL)?.bindings;
    expect(lockBindings(first.issued)).toEqual([
      ADVISORY_LOCK_NAMESPACES.userPassGrants,
      1,
    ]);
    expect(lockBindings(second.issued)).toEqual([
      ADVISORY_LOCK_NAMESPACES.userPassGrants,
      2,
    ]);
  });

  it('extends from the latest active expiry read under the lock', async () => {
    const latest = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    let selects = 0;
    const { database, issued } = recordingDatabase((sql) => {
      if (sql.startsWith('select * from')) {
        selects += 1;
        return selects === 2
          ? { command: 'SELECT', rows: [passRow(42, 'pi_old', latest)] }
          : selectNothing();
      }
      if (sql.startsWith('insert')) {
        return { command: 'INSERT', rows: [passRow(42, 'pi_new', latest)] };
      }
      return selectNothing();
    });

    await new UserPassRepository(database).upsertWithExtension(
      42,
      '7d',
      DURATION_7D,
      'pi_new',
      NOW
    );

    const insert = issued.find(({ sql }) => sql.startsWith('insert'));
    expect(insert?.bindings).toContainEqual(
      new Date(latest.getTime() + DURATION_7D)
    );
  });

  it('returns the existing pass for a replayed payment intent without inserting', async () => {
    const existing = passRow(42, 'pi_replay', new Date(NOW.getTime() + 1000));
    const { database, issued } = recordingDatabase((sql) =>
      sql.startsWith('select * from')
        ? { command: 'SELECT', rows: [existing] }
        : selectNothing()
    );

    const pass = await new UserPassRepository(database).upsertWithExtension(
      42,
      '7d',
      DURATION_7D,
      'pi_replay',
      NOW
    );

    expect(pass).toMatchObject({
      id: 7,
      stripe_payment_intent_id: 'pi_replay',
    });
    expect(issued.map(({ sql }) => sql.split(' ')[0])).toEqual([
      'BEGIN;',
      'select',
      'select',
      'COMMIT;',
    ]);
  });

  it('rolls back and releases the connection when the insert fails', async () => {
    const failure = Object.assign(new Error('fk violation'), { code: '23503' });
    const { database, issued, released } = recordingDatabase((sql) =>
      sql.startsWith('insert') ? failure : selectNothing()
    );

    await expect(
      new UserPassRepository(database).upsertWithExtension(
        42,
        '7d',
        DURATION_7D,
        'pi_fails',
        NOW
      )
    ).rejects.toMatchObject({ code: '23503' });

    expect(issued.map(({ sql }) => sql.split(' ')[0])).toEqual([
      'BEGIN;',
      'select',
      'select',
      'select',
      'insert',
      'ROLLBACK',
    ]);
    expect(released).toEqual([1]);
  });

  it('after a unique violation, rolls back and re-reads the winning pass outside the transaction', async () => {
    const winner = passRow(42, 'pi_raced', new Date(NOW.getTime() + 1000));
    let rolledBack = false;
    const { database, issued } = recordingDatabase((sql) => {
      if (sql.startsWith('insert')) {
        return uniqueViolation();
      }
      if (sql.startsWith('ROLLBACK')) {
        rolledBack = true;
      }
      if (rolledBack && sql.startsWith('select * from')) {
        return { command: 'SELECT', rows: [winner] };
      }
      return selectNothing();
    });

    const pass = await new UserPassRepository(database).upsertWithExtension(
      42,
      '7d',
      DURATION_7D,
      'pi_raced',
      NOW
    );

    expect(pass).toMatchObject({ id: 7, stripe_payment_intent_id: 'pi_raced' });
    const reread = issued[issued.length - 1];
    expect(reread.sql).toContain('"stripe_payment_intent_id" = $1');
    expect(reread.connection).not.toBe(issued[0].connection);
  });
});
