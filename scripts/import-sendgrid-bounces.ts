// Import a SendGrid suppression export (Suppressions → Bounces → Export CSV)
// into the local suppression_events table, so addresses that bounced before
// the event webhook existed count as suppressed: EmailService stops writing to
// them and DeleteInactiveUsersUseCase's dead-address path deletes the inactive
// accounts behind them.
//
// Usage (on the prod host, CSV kept OUT of the repo):
//   npx tsx --env-file=.env scripts/import-sendgrid-bounces.ts <export.csv>
//
// Idempotent: each row's synthetic sg_event_id is derived from the address
// hash and bounce timestamp, so re-running the same export records nothing new.
import { readFileSync } from 'fs';

import { getDatabase } from '../src/data_layer';
import {
  DuplicateSuppressionEventError,
  SuppressionEventsRepository,
} from '../src/data_layer/SuppressionEventsRepository';
import { emailHash } from '../src/lib/emailHash';
import { parseBounceExport } from '../src/lib/sendgrid/parseBounceExport';

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error(
      'Usage: npx tsx --env-file=.env scripts/import-sendgrid-bounces.ts <export.csv>'
    );
    process.exitCode = 1;
    return;
  }

  const { rows, skipped } = parseBounceExport(readFileSync(csvPath, 'utf8'));
  console.info(`parsed ${rows.length} bounce row(s), skipped ${skipped}`);

  const database = getDatabase();
  const repository = new SuppressionEventsRepository(database);

  let recorded = 0;
  let duplicates = 0;
  for (const row of rows) {
    const hash = emailHash(row.email);
    try {
      await repository.record({
        emailHash: hash,
        eventType: 'bounce',
        sgEventId: `import-bounce-${row.created}-${hash}`,
        eventAt: new Date(row.created * 1000),
      });
      recorded++;
    } catch (error) {
      if (error instanceof DuplicateSuppressionEventError) {
        duplicates++;
        continue;
      }
      throw error;
    }
  }

  console.info(
    `recorded ${recorded} suppression event(s), ${duplicates} already present`
  );
  await database.destroy();
}

main().catch((error) => {
  console.error('[import-sendgrid-bounces] failed:', error);
  process.exitCode = 1;
});
