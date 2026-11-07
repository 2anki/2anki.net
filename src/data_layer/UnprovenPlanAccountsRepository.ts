import type { Knex } from 'knex';

export interface IUnprovenPlanAccountsRepository {
  findCandidateEmails(): Promise<string[]>;
}

// Unverified accounts on the payer address of a live plan linked to nobody else.
// A row linked to another account leaves out a person who still has the plan on
// that account. This only narrows the list: holdsUnprovenPlan decides.
export const buildCandidateEmailsQuery = (database: Knex): Knex.QueryBuilder =>
  database('users')
    .join('subscriptions', function joinPayerRow() {
      this.on(
        database.raw(
          'lower(trim(users.email)) = lower(trim(subscriptions.email))'
        )
      );
    })
    .where('users.email_verified', false)
    .where('subscriptions.active', true)
    .where(function linkedToNobodyElse() {
      this.whereNull('subscriptions.linked_email').orWhereRaw(
        'lower(trim(subscriptions.linked_email)) = lower(trim(users.email))'
      );
    })
    .select('users.email');

export class UnprovenPlanAccountsRepository implements IUnprovenPlanAccountsRepository {
  constructor(private readonly database: Knex) {}

  async findCandidateEmails(): Promise<string[]> {
    const rows: Array<{ email: string }> = await buildCandidateEmailsQuery(
      this.database
    );
    return rows.map((row) => row.email);
  }
}
