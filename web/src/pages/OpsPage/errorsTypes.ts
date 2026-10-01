export type {
  ErrorGroupRow as ErrorGroup,
  ErrorGroupsResponse,
} from '@server/types/ops/Errors';

export type ErrorSort = 'last_seen' | 'occurrences';
export type ErrorSource = 'all' | 'web' | 'server';
export type ErrorStatus = 'unresolved' | 'resolved' | 'all';
