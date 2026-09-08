import { DismissPitchUseCase } from './DismissPitchUseCase';
import type { PitchPlacement } from '../../data_layer/PitchDismissalsRepository';

function makeInMemoryDismissalRepo() {
  const store: Array<{
    user_id: string;
    placement: PitchPlacement;
    dismissed_at: Date;
  }> = [];
  return {
    store,
    async upsertDismissal(
      userId: string,
      placement: PitchPlacement
    ): Promise<void> {
      const existing = store.findIndex(
        (d) => d.user_id === userId && d.placement === placement
      );
      const entry = { user_id: userId, placement, dismissed_at: new Date() };
      if (existing >= 0) {
        store[existing] = entry;
      } else {
        store.push(entry);
      }
    },
  };
}

describe('DismissPitchUseCase', () => {
  it('saves a dismissal for the given user and placement', async () => {
    const repo = makeInMemoryDismissalRepo();
    const useCase = new DismissPitchUseCase(repo);
    await useCase.execute('u1', 'convert_success');
    expect(repo.store).toHaveLength(1);
    expect(repo.store[0]).toMatchObject({
      user_id: 'u1',
      placement: 'convert_success',
    });
  });

  it('upserts on repeat dismissal — does not create duplicate rows', async () => {
    const repo = makeInMemoryDismissalRepo();
    const useCase = new DismissPitchUseCase(repo);
    await useCase.execute('u1', 'convert_success');
    await useCase.execute('u1', 'convert_success');
    expect(repo.store).toHaveLength(1);
  });

  it('saves separate rows for different placements', async () => {
    const repo = makeInMemoryDismissalRepo();
    const useCase = new DismissPitchUseCase(repo);
    await useCase.execute('u1', 'convert_success');
    await useCase.execute('u1', 'account_banner');
    expect(repo.store).toHaveLength(2);
  });

  it('saves a dismissal for the producer prompt placement', async () => {
    const repo = makeInMemoryDismissalRepo();
    const useCase = new DismissPitchUseCase(repo);
    await useCase.execute('u1', 'producer_prompt');
    expect(repo.store[0]).toMatchObject({
      user_id: 'u1',
      placement: 'producer_prompt',
    });
  });

  it('saves a dismissal for the post download nudge placement', async () => {
    const repo = makeInMemoryDismissalRepo();
    const useCase = new DismissPitchUseCase(repo);
    await useCase.execute('u1', 'post_download_nudge');
    expect(repo.store[0]).toMatchObject({
      user_id: 'u1',
      placement: 'post_download_nudge',
    });
  });

  it('throws when placement value is invalid', async () => {
    const repo = makeInMemoryDismissalRepo();
    const useCase = new DismissPitchUseCase(repo);
    await expect(
      useCase.execute('u1', 'bad_placement' as PitchPlacement)
    ).rejects.toThrow('Invalid placement');
  });
});
