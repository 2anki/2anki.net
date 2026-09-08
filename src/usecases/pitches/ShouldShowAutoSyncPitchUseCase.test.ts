import { ShouldShowAutoSyncPitchUseCase } from './ShouldShowAutoSyncPitchUseCase';
import type { PitchPlacement } from '../../data_layer/PitchDismissalsRepository';

const MS_60_DAYS = 60 * 24 * 60 * 60 * 1000;

function makeUserWithAccess() {
  return { patreon: true as boolean | null };
}

function makeUserWithoutAccess() {
  return { patreon: false as boolean | null };
}

function makeJobRepo(
  priorJobs: Array<{ object_id: string; created_at: Date; type: string | null }>
) {
  return {
    async findPriorNotionJobByOwnerAndObjectId(
      _owner: string,
      objectId: string,
      _windowMs: number
    ) {
      return priorJobs.find(
        (j) =>
          j.object_id === objectId &&
          (j.type === 'page' || j.type === 'database')
      );
    },
    async countRecentNotionJobsByOwner(
      _owner: string,
      _windowMs: number
    ): Promise<number> {
      return priorJobs.filter((j) => j.type === 'page' || j.type === 'database')
        .length;
    },
  };
}

function makeDismissalRepo(
  dismissals: Array<{
    user_id: string;
    placement: PitchPlacement;
    dismissed_at: Date;
  }>
) {
  return {
    async findActiveDismissal(
      userId: string,
      placement: PitchPlacement,
      windowMs: number
    ) {
      const cutoff = new Date(Date.now() - windowMs);
      return dismissals.find(
        (d) =>
          d.user_id === userId &&
          d.placement === placement &&
          d.dismissed_at >= cutoff
      );
    },
  };
}

describe('ShouldShowAutoSyncPitchUseCase', () => {
  it('returns false everywhere when user has ankify access', async () => {
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([]),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'notion-page-id',
      jobType: 'page',
    });
    expect(result).toEqual({
      convertSuccess: false,
      accountBanner: false,
      producerPrompt: true,
      postDownloadNudge: false,
    });
  });

  it('returns postDownloadNudge true for a free user with no dismissal', async () => {
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([]),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: null,
      subscriptions: [],
      userId: 'u1',
      objectId: '',
      jobType: null,
    });
    expect(result.postDownloadNudge).toBe(true);
  });

  it('returns postDownloadNudge false once post_download_nudge is dismissed', async () => {
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([]),
      makeDismissalRepo([
        {
          user_id: 'u1',
          placement: 'post_download_nudge',
          dismissed_at: new Date(),
        },
      ]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: null,
      subscriptions: [],
      userId: 'u1',
      objectId: '',
      jobType: null,
    });
    expect(result.postDownloadNudge).toBe(false);
  });

  it('shows the producer prompt even for ankify-access users when not dismissed', async () => {
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([]),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'notion-page-id',
      jobType: 'page',
    });
    expect(result.producerPrompt).toBe(true);
  });

  it('hides the producer prompt once producer_prompt is dismissed', async () => {
    const dismissal = {
      user_id: 'u1',
      placement: 'producer_prompt' as PitchPlacement,
      dismissed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    };
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([]),
      makeDismissalRepo([dismissal]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'notion-page-id',
      jobType: 'page',
    });
    expect(result.producerPrompt).toBe(false);
  });

  it('returns false for convertSuccess when no prior job exists', async () => {
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([]),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'notion-page-id',
      jobType: 'page',
    });
    expect(result.convertSuccess).toBe(false);
  });

  it('returns convertSuccess true when prior notion job exists within window', async () => {
    const priorJob = {
      object_id: 'notion-page-id',
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      type: 'page',
    };
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([priorJob]),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'notion-page-id',
      jobType: 'page',
    });
    expect(result.convertSuccess).toBe(true);
  });

  it('returns convertSuccess false when convert_success placement is dismissed within 60 days', async () => {
    const priorJob = {
      object_id: 'notion-page-id',
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      type: 'page',
    };
    const dismissal = {
      user_id: 'u1',
      placement: 'convert_success' as PitchPlacement,
      dismissed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    };
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([priorJob]),
      makeDismissalRepo([dismissal]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'notion-page-id',
      jobType: 'page',
    });
    expect(result.convertSuccess).toBe(false);
  });

  it('returns accountBanner true when user has more than 1 recent notion job', async () => {
    const jobs = [
      {
        object_id: 'page-1',
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        type: 'page',
      },
      {
        object_id: 'page-2',
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        type: 'page',
      },
    ];
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo(jobs),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'page-3',
      jobType: 'page',
    });
    expect(result.accountBanner).toBe(true);
  });

  it('returns accountBanner false when user has 1 or fewer recent notion jobs', async () => {
    const jobs = [
      {
        object_id: 'page-1',
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        type: 'page',
      },
    ];
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo(jobs),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'page-2',
      jobType: 'page',
    });
    expect(result.accountBanner).toBe(false);
  });

  it('returns accountBanner false when account_banner placement is dismissed within 60 days', async () => {
    const jobs = [
      {
        object_id: 'page-1',
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        type: 'page',
      },
      {
        object_id: 'page-2',
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        type: 'page',
      },
    ];
    const dismissal = {
      user_id: 'u1',
      placement: 'account_banner' as PitchPlacement,
      dismissed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    };
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo(jobs),
      makeDismissalRepo([dismissal]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'page-3',
      jobType: 'page',
    });
    expect(result.accountBanner).toBe(false);
  });

  it('returns convertSuccess false when jobType is not a notion type', async () => {
    const priorJob = {
      object_id: 'some-id',
      created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      type: 'page',
    };
    const useCase = new ShouldShowAutoSyncPitchUseCase(
      makeJobRepo([priorJob]),
      makeDismissalRepo([]),
      'prod-auto-sync-id'
    );
    const result = await useCase.execute({
      user: makeUserWithoutAccess(),
      subscriptions: [],
      userId: 'u1',
      objectId: 'some-id',
      jobType: 'upload',
    });
    expect(result.convertSuccess).toBe(false);
  });
});
