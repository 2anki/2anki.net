import { spawn } from 'node:child_process';
import { startChild } from '../../lib/conversionChildRuntime';

// A real forked child used by conversionChild.integration.test.ts to exercise
// the scheduler's handling of actual processes — serialization round-trips,
// progress over IPC, a mid-task crash, a hang, and a spawned grandchild that the
// process-group kill must reap. It speaks the same protocol as the real
// conversionChild but runs test handlers instead of conversions, so no DB.

interface FixturePayload {
  type: string;
  value?: unknown;
  steps?: string[];
  bytes?: number;
}

async function handle(
  payload: unknown,
  onProgress: (step: string) => void
): Promise<unknown> {
  const task = payload as FixturePayload;
  switch (task.type) {
    case 'echo':
      return task.value;
    case 'progress':
      for (const step of task.steps ?? []) {
        onProgress(step);
      }
      return task.value;
    case 'crash':
      // Dies mid-task; the scheduler must reject with ConversionChildCrashedError.
      process.exit(137);
      return undefined;
    case 'hang':
      await new Promise<void>(() => {});
      return undefined;
    case 'allocate': {
      const buffer = Buffer.alloc(task.bytes ?? 0, 1);
      return buffer.length;
    }
    case 'spawn-grandchild': {
      const grandchild = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000000)'],
        { stdio: 'ignore' }
      );
      grandchild.unref();
      return grandchild.pid;
    }
    default:
      throw new Error(`fixture: unknown task type ${task.type}`);
  }
}

startChild({ handle });
