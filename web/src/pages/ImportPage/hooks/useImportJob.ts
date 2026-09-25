import { useCallback, useEffect, useRef, useState } from 'react';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';

type ImportJobPhase = 'idle' | 'uploading' | 'polling' | 'completed' | 'failed';

interface ImportJobProgress {
  total_notes: number;
  imported: number;
}

interface ImportJobState {
  phase: ImportJobPhase;
  progress: ImportJobProgress;
  statusText: string | null;
  notionPageUrl: string | null;
  errorMessage: string | null;
  truncated: boolean;
}

const POLL_INTERVAL_MS = 2000;

export default function useImportJob() {
  const [state, setState] = useState<ImportJobState>({
    phase: 'idle',
    progress: { total_notes: 0, imported: 0 },
    statusText: null,
    notionPageUrl: null,
    errorMessage: null,
    truncated: false,
  });

  const jobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (jobId == null) return;

    try {
      const result = await get2ankiApi().getImportJobStatus(jobId);

      if (result.status === 'done') {
        stopPolling();
        setState({
          phase: 'completed',
          progress: result.progress,
          statusText: null,
          notionPageUrl: result.notion_page_url ?? null,
          errorMessage: null,
          truncated: result.truncated === true,
        });
      } else if (result.status === 'failed') {
        stopPolling();
        setState({
          phase: 'failed',
          progress: result.progress,
          statusText: null,
          notionPageUrl: null,
          errorMessage: result.error ?? null,
          truncated: false,
        });
      } else {
        setState((prev) => ({
          ...prev,
          phase: 'polling',
          progress: result.progress,
          statusText: result.status_text ?? null,
        }));
      }
    } catch (err) {
      stopPolling();
      setState((prev) => ({
        ...prev,
        phase: 'failed',
        errorMessage: err instanceof Error ? err.message : null,
      }));
    }
  }, [stopPolling]);

  const startPolling = useCallback(
    (jobId: string) => {
      jobIdRef.current = jobId;
      stopPolling();
      pollTimerRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
    },
    [pollStatus, stopPolling]
  );

  const submit = useCallback(
    async (file: File, notionPageId?: string) => {
      setState({
        phase: 'uploading',
        progress: { total_notes: 0, imported: 0 },
        statusText: null,
        notionPageUrl: null,
        errorMessage: null,
        truncated: false,
      });

      try {
        const result = await get2ankiApi().startImportToNotion(
          file,
          notionPageId
        );
        setState((prev) => ({ ...prev, phase: 'polling' }));
        startPolling(result.job_id);
      } catch (err) {
        setState({
          phase: 'failed',
          progress: { total_notes: 0, imported: 0 },
          statusText: null,
          notionPageUrl: null,
          errorMessage: err instanceof Error ? err.message : null,
          truncated: false,
        });
      }
    },
    [startPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    jobIdRef.current = null;
    setState({
      phase: 'idle',
      progress: { total_notes: 0, imported: 0 },
      statusText: null,
      notionPageUrl: null,
      errorMessage: null,
      truncated: false,
    });
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { ...state, submit, reset };
}
