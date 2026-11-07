import type { Knex } from 'knex';

export interface IUnprovenPlanAccountsRepository {
  findCandidateEmails(): Promise<string[]>;
}

// Unverified accounts on the payer address of a row linked to nobody. A row with
// a link leaves out a person who still has the plan on that account. This only
// narrows the list, past-due and paused plans included: isLockedOutOfPlan decides.
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
    .whereNull('subscriptions.linked_email')
    .select('users.email');

export class UnprovenPlanAccountsRepository implements IUnprovenPlanAccountsRepository {
  constructor(private readonly database: Knex) {}

  async findCandidateEmails(): Promise<string[]> {
    const rows: Array<{ email: string }> = await buildCandidateEmailsQuery(
      this.database
    );
    return [...new Set(rows.map((row) => row.email.toLowerCase().trim()))];
  }
}
