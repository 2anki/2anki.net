import {
  PITCH_PLACEMENTS,
  type PitchPlacement,
} from '../../data_layer/PitchDismissalsRepository';

interface DismissalWritePort {
  upsertDismissal(userId: string, placement: PitchPlacement): Promise<void>;
}

export class DismissPitchUseCase {
  constructor(private readonly dismissalRepo: DismissalWritePort) {}

  async execute(userId: string, placement: PitchPlacement): Promise<void> {
    if (!PITCH_PLACEMENTS.includes(placement)) {
      throw new Error(`Invalid placement: ${placement}`);
    }
    await this.dismissalRepo.upsertDismissal(userId, placement);
  }
}
