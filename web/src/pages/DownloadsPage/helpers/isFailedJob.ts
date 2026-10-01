import type Jobs from '@server/data_layer/public/Jobs';

export const isFailedJob = (j: Jobs) => j.status === 'failed';
