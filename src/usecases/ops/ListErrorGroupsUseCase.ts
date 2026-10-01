import {
  IErrorEventRepository,
  ListErrorGroupsOptions,
} from '../../data_layer/ErrorEventRepository';
import type { ErrorGroupsResponse } from '../../types/ops/Errors';

export type ListErrorGroupsResult = ErrorGroupsResponse;

export class ListErrorGroupsUseCase {
  constructor(private readonly repository: IErrorEventRepository) {}

  async execute(
    options: ListErrorGroupsOptions
  ): Promise<ListErrorGroupsResult> {
    const [rawGroups, totalGroups] = await Promise.all([
      this.repository.listGroups(options),
      this.repository.countGroups(options.source, options.status),
    ]);
    const groups = rawGroups.map(
      ({
        message_hash,
        message,
        stack,
        url,
        release,
        source,
        user_id,
        user_agent,
        first_seen,
        last_seen,
        occurrences,
        resolved,
        resolved_at,
      }) => ({
        message_hash,
        message,
        stack,
        url,
        release,
        source,
        user_id,
        user_agent,
        first_seen,
        last_seen,
        occurrences,
        resolved,
        resolved_at,
      })
    );
    return { groups, totalGroups };
  }
}
