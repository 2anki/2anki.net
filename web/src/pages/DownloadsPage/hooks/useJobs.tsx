import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorHandlerType } from '../../../components/errors/helpers/getErrorMessage';

import Backend from '../../../lib/backend';
import { UserNotice } from '../../../lib/errors/UserNotice';
import { track } from '../../../lib/analytics/track';
import { JobsId } from '../../../schemas/public/Jobs';
import JobResponse from '../../../schemas/public/JobResponse';

export interface RestartUiState {
  inFlight: boolean;
  exhausted: boolean;
  expired: boolean;
}

interface UseJobsResult {
  jobs: JobResponse[];
  deleteJob: (id: JobsId) => Promise<void>;
  restartJob: (job: JobResponse) => Promise<void>;
  refreshJobs: () => Promise<void>;
  lastFetchedAt: Date | null;
  restartUi: Record<string, RestartUiState>;
}

function statusOf(error: unknown): number | undefined {
  if (error != null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function codeOf(error: unknown): string | undefined {
  if (error != null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function isTransientPollError(error: unknown): boolean {
  const status = statusOf(error);
  if (status == null) return false;
  return status === 0 || status >= 500;
}

const TERMINAL_NON_FAILED = new Set(['done', 'cancelled', 'interrupted']);

export default function useJobs(
  backend: Backend,
  setError: ErrorHandlerType
): UseJobsResult {
  const { t } = useTranslation('downloadsx');
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [isWarmup, setIsWarmup] = useState(true);
  const [restartUi, setRestartUi] = useState<Record<string, RestartUiState>>(
    {}
  );
  // Refs, not state: the polling interval closes over one render's fetchJobs,
  // and a second click must be rejected synchronously, before React re-renders.
  const restartWatch = useRef(new Map<string, string | null>());
  const restartInFlight = useRef(new Set<string>());

  useEffect(() => {
    const t = setTimeout(() => setIsWarmup(false), 15000);
    return () => clearTimeout(t);
  }, []);

  function patchRestartUi(objectId: string, patch: Partial<RestartUiState>) {
    setRestartUi((prev) => {
      const current = prev[objectId] ?? {
        inFlight: false,
        exhausted: false,
        expired: false,
      };
      return { ...prev, [objectId]: { ...current, ...patch } };
    });
  }

  // A restart the server accepted (202) has already claimed the job, so any
  // later poll that shows it failed again is the restart's own outcome. The
  // same failure reason twice in a row means retrying cannot help.
  function settleWatchedRestarts(active: JobResponse[]) {
    for (const [objectId, reason] of restartWatch.current) {
      const job = active.find((j) => j.object_id === objectId);
      if (!job || TERMINAL_NON_FAILED.has(job.status)) {
        restartWatch.current.delete(objectId);
        continue;
      }
      if (job.status !== 'failed') continue;
      restartWatch.current.delete(objectId);
      if (job.job_reason_failure === reason) {
        patchRestartUi(objectId, { exhausted: true });
        track('restart_exhausted_notice_shown');
      }
    }
  }

  async function fetchJobs() {
    try {
      const active = await backend.getJobs();
      setJobs(active);
      setLastFetchedAt(new Date());
      settleWatchedRestarts(active);
    } catch (error) {
      if (isTransientPollError(error)) return;
      setError(error);
    }
  }

  async function deleteJob(id: JobsId) {
    try {
      await backend.deleteJob(id);
      setJobs((prev) => prev.filter((job) => job.id !== id));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Cannot delete job while it is in progress')
      ) {
        setError(new UserNotice(t('jobs.deleteInProgress')));
      } else {
        setError(error);
      }
    }
  }

  async function restartJob(job: JobResponse) {
    if (job.type !== 'claude') {
      try {
        await backend.convert(job.object_id, job.type, job.title);
        await fetchJobs();
      } catch (error) {
        setError(error);
      }
      return;
    }

    const objectId = job.object_id;
    if (restartInFlight.current.has(objectId)) return;
    restartInFlight.current.add(objectId);
    patchRestartUi(objectId, { inFlight: true });
    restartWatch.current.set(objectId, job.job_reason_failure ?? null);
    try {
      await backend.restartClaudeJob(objectId);
      await fetchJobs();
    } catch (error) {
      restartWatch.current.delete(objectId);
      if (statusOf(error) === 409 && codeOf(error) === 'workspace_gone') {
        patchRestartUi(objectId, { expired: true });
      } else if (
        statusOf(error) === 409 &&
        codeOf(error) === 'already_running'
      ) {
        await fetchJobs();
      } else {
        setError(error);
      }
    } finally {
      restartInFlight.current.delete(objectId);
      patchRestartUi(objectId, { inFlight: false });
    }
  }

  const hasActiveJobs = jobs.some(
    (j) => !['done', 'failed', 'cancelled', 'interrupted'].includes(j.status)
  );

  useEffect(() => {
    fetchJobs();
    const intervalMs = hasActiveJobs || isWarmup ? 3000 : 10000;
    const intervalId = setInterval(fetchJobs, intervalMs);
    return () => clearInterval(intervalId);
  }, [backend, hasActiveJobs, isWarmup]);

  return {
    jobs,
    deleteJob,
    restartJob,
    refreshJobs: fetchJobs,
    lastFetchedAt,
    restartUi,
  };
}
