import { Knex } from 'knex';

export const PITCH_PLACEMENTS = [
  'convert_success',
  'account_banner',
  'producer_prompt',
  'post_download_nudge',
] as const;

export type PitchPlacement = (typeof PITCH_PLACEMENTS)[number];

export interface PitchDismissal {
  id: number;
  user_id: string;
  placement: PitchPlacement;
  dismissed_at: Date;
}

class PitchDismissalsRepository {
  constructor(private readonly database: Knex) {}

  async upsertDismissal(
    userId: string,
    placement: PitchPlacement
  ): Promise<void> {
    await this.database('pitch_dismissals')
      .insert({ user_id: userId, placement, dismissed_at: new Date() })
      .onConflict(['user_id', 'placement'])
      .merge({ dismissed_at: new Date() });
  }

  async findActiveDismissal(
    userId: string,
    placement: PitchPlacement,
    windowMs: number
  ): Promise<PitchDismissal | undefined> {
    const cutoff = new Date(Date.now() - windowMs);
    return this.database<PitchDismissal>('pitch_dismissals')
      .where({ user_id: userId, placement })
      .where('dismissed_at', '>=', cutoff)
      .first();
  }
}

export default PitchDismissalsRepository;
