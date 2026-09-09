import {
  TodaySnapshotResponse,
  TodaySnapshotService,
} from '../../services/ops/TodaySnapshotService';

export class GetTodaySnapshotUseCase {
  constructor(private readonly service: TodaySnapshotService) {}

  execute(): Promise<TodaySnapshotResponse> {
    return this.service.getSnapshot();
  }
}

export default GetTodaySnapshotUseCase;
