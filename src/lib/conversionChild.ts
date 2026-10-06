import { startChild } from './conversionChildRuntime';
import { runConversionInWorker } from './conversionTasks';
import { runUploadGenerationInWorker } from '../usecases/uploads/worker';
import type { ConversionChildTaskPayload } from './conversionChildProtocol';
import { getEventsSink } from '../services/events/eventsSinkInstance';
import { getDatabase } from '../data_layer';

async function handle(
  payload: unknown,
  onProgress: (step: string) => void
): Promise<unknown> {
  const task = payload as ConversionChildTaskPayload;
  if (task.type === 'conversion') {
    await runConversionInWorker(task.request);
    return undefined;
  }
  if (task.type === 'upload') {
    return runUploadGenerationInWorker(task.task, onProgress);
  }
  throw new Error('[conversion-child] unknown task payload type');
}

async function onRetire(): Promise<void> {
  try {
    await getEventsSink().drain();
  } finally {
    await getDatabase().destroy();
  }
}

startChild({ handle, onRetire });
