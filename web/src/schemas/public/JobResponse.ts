import Jobs from './Jobs';

/**
 * API response shape for a job — extends the DB type with fields that are
 * computed server-side and not stored as columns, so kanel can regenerate
 * Jobs.ts freely without losing these. conversion_report is omitted on
 * purpose: the polled jobs list never carries it, the report is fetched
 * lazily per job (#4211).
 */
export default interface JobResponse extends Omit<Jobs, 'conversion_report'> {
  restartable: boolean;
  download_key: string | null;
  upload_id: number | null;
  /** Toggles the stored report counted as empty; 0 when there is no report. */
  empty_back_count: number;
}
