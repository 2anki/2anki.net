import { Knex } from 'knex';
import Jobs from './public/Jobs';

export interface JobWithDownloadKey extends Jobs {
  download_key: string | null;
  upload_id: number | null;
}

class JobRepository {
  tableName = 'jobs';

  constructor(private readonly database: Knex) {}

  getJobsByOwner(owner: string): Promise<JobWithDownloadKey[]> {
    const latestUpload = this.database('uploads')
      .select('object_id')
      .max({ max_id: 'id' })
      .where({ owner })
      .whereNotNull('object_id')
      .groupBy('object_id')
      .as('latest_upload');

    return this.database(this.tableName)
      .leftJoin(latestUpload, 'latest_upload.object_id', 'jobs.object_id')
      .leftJoin('uploads', 'uploads.id', 'latest_upload.max_id')
      .where({ 'jobs.owner': owner })
      .select(
        'jobs.*',
        'uploads.key as download_key',
        'uploads.id as upload_id'
      );
  }

  deleteJob(id: string, owner: string) {
    return this.database(this.tableName).delete().where({
      id: id,
      owner: owner,
    });
  }

  deleteJobByObjectId(objectId: string, owner: string): Promise<number> {
    return this.database(this.tableName).delete().where({
      object_id: objectId,
      owner: owner,
    });
  }

  async create(
    id: string,
    owner: string,
    title?: string | null,
    type?: string
  ): Promise<Jobs | undefined> {
    const rows = await this.database(this.tableName)
      .insert({
        type,
        title,
        object_id: id,
        owner,
        status: 'started',
        last_edited_time: new Date(),
      })
      .onConflict(['object_id', 'owner'])
      .ignore()
      .returning('*');
    return rows[0] as Jobs | undefined;
  }

  findJobById(id: string, owner: string) {
    return this.database(this.tableName)
      .where({ object_id: id, owner })
      .returning('*')
      .first();
  }

  findConversionReportRow(
    objectId: string,
    owner: string
  ): Promise<Pick<Jobs, 'conversion_report'> | undefined> {
    return this.database<Jobs>(this.tableName)
      .where({ object_id: objectId, owner })
      .select('conversion_report')
      .first();
  }

  findJobByObjectId(
    objectId: string
  ): Promise<Pick<Jobs, 'title' | 'created_at'> | undefined> {
    return this.database<Jobs>(this.tableName)
      .where({ object_id: objectId })
      .select('title', 'created_at')
      .first();
  }

  findPriorNotionJobByOwnerAndObjectId(
    owner: string,
    objectId: string,
    windowMs: number
  ): Promise<Pick<Jobs, 'object_id' | 'created_at' | 'type'> | undefined> {
    const cutoff = new Date(Date.now() - windowMs);
    return this.database<Jobs>(this.tableName)
      .where({ owner, object_id: objectId })
      .whereIn('type', ['page', 'database'])
      .where('created_at', '>=', cutoff)
      .select('object_id', 'created_at', 'type')
      .first();
  }

  countRecentNotionJobsByOwner(
    owner: string,
    windowMs: number
  ): Promise<number> {
    const cutoff = new Date(Date.now() - windowMs);
    return this.database(this.tableName)
      .where({ owner })
      .whereIn('type', ['page', 'database'])
      .where('created_at', '>=', cutoff)
      .count('* as count')
      .first()
      .then((row) => Number((row as { count: string | number })?.count ?? 0));
  }

  markInterruptedClaudeJobs() {
    return this.database(this.tableName)
      .whereNotIn('status', ['done', 'failed', 'cancelled', 'interrupted'])
      .where({ type: 'claude' })
      .update({ status: 'interrupted', last_edited_time: new Date() });
  }

  markInterruptedNotionJobs() {
    return this.database(this.tableName)
      .whereNotIn('status', ['done', 'failed', 'cancelled', 'interrupted'])
      .whereIn('type', ['page', 'database', 'conversion'])
      .update({ status: 'interrupted', last_edited_time: new Date() });
  }

  // Boot-time sweep for job types with no interrupted-marking of their own.
  // Claude and Notion types are excluded: their markInterrupted* methods above
  // own those rows, and this sweep used to run first and convert every
  // in-flight Notion job to 'failed' with no reason, making
  // markInterruptedNotionJobs dead code (#4176).
  failStrandedLegacyJobs() {
    return this.database(this.tableName)
      .whereNotIn('status', ['done', 'failed', 'cancelled', 'interrupted'])
      .where((qb) =>
        qb
          .whereNull('type')
          .orWhereNotIn('type', ['claude', 'page', 'database', 'conversion'])
      )
      .update({ status: 'failed' });
  }

  static readonly TERMINAL_STATUSES = [
    'done',
    'failed',
    'cancelled',
    'interrupted',
  ];

  static readonly RESTARTABLE_TERMINAL_STATUSES = [
    'done',
    'failed',
    'interrupted',
  ];

  async restartJob(id: string, owner: string): Promise<Jobs | undefined> {
    const rows = await this.database(this.tableName)
      .where({ object_id: id, owner })
      .whereIn('status', JobRepository.TERMINAL_STATUSES)
      .update({
        status: 'started',
        job_reason_failure: '',
        last_edited_time: new Date(),
      })
      .returning('*');
    return rows[0] as Jobs | undefined;
  }

  async claimStaleOrTerminalJob(
    id: string,
    owner: string,
    stalenessMs: number
  ): Promise<Jobs | undefined> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - stalenessMs);
    const rows = await this.database(this.tableName)
      .where({ object_id: id, owner })
      .where((claimable) => {
        claimable
          .whereIn('status', JobRepository.RESTARTABLE_TERMINAL_STATUSES)
          .orWhere((staleInFlight) => {
            staleInFlight
              .whereNotIn('status', JobRepository.TERMINAL_STATUSES)
              .andWhere('last_edited_time', '<', staleCutoff);
          });
      })
      .update({
        status: 'started',
        job_reason_failure: '',
        last_edited_time: now,
      })
      .returning('*');
    return rows[0] as Jobs | undefined;
  }

  async updateJobStatus(
    id: string,
    owner: string,
    status: string,
    description?: string,
    cardCount?: number,
    conversionReport?: unknown
  ): Promise<Jobs | undefined> {
    const isTerminal = JobRepository.TERMINAL_STATUSES.includes(status);
    const query = this.database(this.tableName).where({ object_id: id, owner });
    if (!isTerminal) {
      query.whereNotIn('status', JobRepository.TERMINAL_STATUSES);
    }
    // A finished deck must never present as failed: a racing writer (pool
    // shutdown, duplicate dispatch) marking failure after the success writer
    // marked done is the bug, not a state to record. done may still overwrite
    // failed — that is the restart path succeeding.
    if (isTerminal && status !== 'done') {
      query.whereNot('status', 'done');
    }
    const update: Record<string, unknown> = {
      status,
      job_reason_failure: description,
      last_edited_time: new Date(),
    };
    if (cardCount != null && cardCount >= 0) {
      update.card_count = cardCount;
    }
    // Written only when the caller has one (the done write); a racing failed
    // write never carries the key, so it can never null out a stored report.
    if (conversionReport != null) {
      update.conversion_report = JSON.stringify(conversionReport);
    }
    const rows = await query.update(update).returning('*');
    return rows[0] as Jobs | undefined;
  }

  countJobsByType(owner: string, type: string): Promise<number> {
    return this.database(this.tableName)
      .where({ owner, type })
      .count('* as count')
      .first()
      .then((row) => Number((row as { count: string | number })?.count ?? 0));
  }

  countJobsByOwner(owner: string): Promise<number> {
    return this.database(this.tableName)
      .where({ owner })
      .count('* as count')
      .first()
      .then((row) => Number((row as { count: string | number })?.count ?? 0));
  }

  deleteOldJobs(type: string, olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    return this.database(this.tableName)
      .where({ type })
      .whereIn('status', JobRepository.TERMINAL_STATUSES)
      .where('last_edited_time', '<', cutoff)
      .delete();
  }
}

export default JobRepository;
