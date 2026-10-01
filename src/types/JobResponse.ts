import type Jobs from '../data_layer/public/Jobs';

/**
 * API response shape for a job. Extends the DB row with fields computed
 * server-side (restartable, download_key, upload_id, empty_back_count) that are
 * not stored columns, so kanel can regenerate Jobs freely. conversion_report is
 * omitted: the polled jobs list never carries it, the report is fetched lazily
 * per job (#4211).
 */
export default interface JobResponse extends Omit<Jobs, 'conversion_report'> {
  restartable: boolean;
  download_key: string | null;
  upload_id: number | null;
  empty_back_count: number;
}
