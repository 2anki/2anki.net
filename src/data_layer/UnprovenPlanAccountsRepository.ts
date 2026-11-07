import type { Knex } from 'knex';

export interface IUnprovenPlanAccountsRepository {
  findCandidateEmails(): Promise<string[]>;
}

// Unverified accounts on the payer address of an active plan linked to nobody. A
// row with a link leaves out a person who still has the plan on that account. A
// past-due or paused plan is out too: confirming would not bring it back.
// isLockedOutOfPlan decides from here.
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
