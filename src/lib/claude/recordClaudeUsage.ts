import { track } from '../../services/events/track';
import { ClaudeUsage, computeUsageCostUsd } from './pricing';

export type { ClaudeUsage } from './pricing';

export interface RecordClaudeUsageOptions {
  surface: string;
  model: string | undefined | null;
  usage: ClaudeUsage | undefined | null;
  userId?: number | null;
  durationMs?: number;
}

export function recordClaudeUsage(options: RecordClaudeUsageOptions): void {
  const { surface, model, usage, userId, durationMs } = options;
  if (usage == null) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const costUsd = computeUsageCostUsd(model, usage);
  console.info(
    `[claude-usage] surface=${surface} model=${model ?? 'unknown'} user=${userId ?? 'anon'} input=${input} output=${output} cache_create=${cacheCreate} cache_read=${cacheRead} cost_usd=${costUsd}`
  );
  try {
    track('ai_usage_recorded', {
      userId: userId ?? null,
      props: {
        surface,
        model: model ?? 'unknown',
        cost_usd: costUsd,
        ...(durationMs != null ? { duration_ms: durationMs } : {}),
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
