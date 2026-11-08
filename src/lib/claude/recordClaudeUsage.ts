import { track } from '../../services/events/track';
import { ClaudeUsage, computeUsageCostUsd } from './pricing';

export type { ClaudeUsage } from './pricing';

export interface RecordClaudeUsageOptions {
  surface: string;
  model: string | undefined | null;
  usage: ClaudeUsage | undefined | null;
  userId?: number | null;
  anonymousPassId?: number | null;
  requestId?: string;
  durationMs?: number;
  // False for a call Claude declined without writing anything usable: its cost
  // is still recorded for ops, but never counted against anyone's AI credits.
  billable?: boolean;
}

export function recordClaudeUsage(options: RecordClaudeUsageOptions): void {
  const {
    surface,
    model,
    usage,
    userId,
    anonymousPassId,
    requestId,
    durationMs,
    billable = true,
  } = options;
  if (usage == null) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const costUsd = computeUsageCostUsd(model, usage);
  const request = requestId ? ` request=${requestId}` : '';
  const biller =
    userId ?? (anonymousPassId != null ? `pass:${anonymousPassId}` : 'anon');
  console.info(
    `[claude-usage] surface=${surface} model=${model ?? 'unknown'} user=${biller}${request} input=${input} output=${output} cache_create=${cacheCreate} cache_read=${cacheRead} cost_usd=${costUsd}${billable ? '' : ' billable=false'}`
  );
  try {
    track('ai_usage_recorded', {
      userId: userId ?? null,
      anonymousPassId: anonymousPassId ?? null,
      props: {
        surface,
        model: model ?? 'unknown',
        cost_usd: costUsd,
        ...(requestId != null ? { request_id: requestId } : {}),
        ...(durationMs != null ? { duration_ms: durationMs } : {}),
        ...(billable ? {} : { billable: false }),
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_creation_input_tokens: cacheCreate,
          cache_read_input_tokens: cacheRead,
        },
      },
    });
  } catch (error) {
    console.error('[claude-usage] failed to record usage event', error);
  }
}
