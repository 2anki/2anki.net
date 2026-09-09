import { ScoreRow } from './todayTypes';
import { useTodaySnapshot } from './useTodaySnapshot';

export const useSectionSummaries = (): ((rowId: string) => ScoreRow | null) => {
  const { data } = useTodaySnapshot();
  return (rowId) => data?.rows.find((row) => row.id === rowId) ?? null;
};
