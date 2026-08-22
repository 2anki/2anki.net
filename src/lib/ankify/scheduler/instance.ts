import { AnkifyExportScheduler } from '../../../services/ankify/AnkifyExportScheduler';

let instance: AnkifyExportScheduler | null = null;

export const setAnkifyExportScheduler = (
  scheduler: AnkifyExportScheduler
): void => {
  instance = scheduler;
};

export const getAnkifyExportScheduler = (): AnkifyExportScheduler => {
  if (instance == null) {
    throw new Error(
      'AnkifyExportScheduler accessed before initialization. Did bootstrapBackgroundJobs run?'
    );
  }
  return instance;
};

export const resetAnkifyExportScheduler = (): void => {
  instance = null;
};
