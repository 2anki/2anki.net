import { hasAnkifyAccess } from '../../lib/ankify/access';
import type {
  AnkifyAccessUser,
  AnkifyAccessSubscription,
} from '../../lib/ankify/access';
import type { PitchPlacement } from '../../data_layer/PitchDismissalsRepository';

const NOTION_JOB_TYPES = new Set(['page', 'database']);
const MS_90_DAYS = 90 * 24 * 60 * 60 * 1000;
const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;
const MS_60_DAYS = 60 * 24 * 60 * 60 * 1000;
const MS_100_YEARS = 100 * 365 * 24 * 60 * 60 * 1000;

interface JobLookupPort {
  findPriorNotionJobByOwnerAndObjectId(
    owner: string,
    objectId: string,
    windowMs: number
  ): Promise<
    | { object_id: string; created_at: Date | null; type: string | null }
    | undefined
  >;
  countRecentNotionJobsByOwner(
    owner: string,
    windowMs: number
  ): Promise<number>;
}

interface DismissalLookupPort {
  findActiveDismissal(
    userId: string,
    placement: PitchPlacement,
    windowMs: number
  ): Promise<unknown>;
}

interface ExecuteParams {
  user: AnkifyAccessUser | null | undefined;
  subscriptions: AnkifyAccessSubscription[];
  userId: string;
  objectId: string;
  jobType: string | null | undefined;
}

interface PitchResult {
  convertSuccess: boolean;
  accountBanner: boolean;
  producerPrompt: boolean;
  postDownloadNudge: boolean;
}

export class ShouldShowAutoSyncPitchUseCase {
  constructor(
    private readonly jobRepo: JobLookupPort,
    private readonly dismissalRepo: DismissalLookupPort,
    private readonly autoSyncProductId: string
  ) {}

  async execute(params: ExecuteParams): Promise<PitchResult> {
    const { user, subscriptions, userId, objectId, jobType } = params;

    const [producerPrompt, postDownloadNudge] = await Promise.all([
      this.checkProducerPrompt(userId),
      this.checkPostDownloadNudge(userId),
    ]);

    if (hasAnkifyAccess(user, subscriptions, this.autoSyncProductId)) {
      return {
        convertSuccess: false,
        accountBanner: false,
        producerPrompt,
        postDownloadNudge: false,
      };
    }

    const [convertSuccess, accountBanner] = await Promise.all([
      this.checkConvertSuccess(userId, objectId, jobType ?? null),
      this.checkAccountBanner(userId),
    ]);

    return { convertSuccess, accountBanner, producerPrompt, postDownloadNudge };
  }

  private async checkProducerPrompt(userId: string): Promise<boolean> {
    const dismissed = await this.dismissalRepo.findActiveDismissal(
      userId,
      'producer_prompt',
      MS_100_YEARS
    );
    return dismissed == null;
  }

  // Dismissal is the only server-side condition: the client already gates on
  // plan (paying users never render the nudge) and the moment itself (a
  // successful conversion) is the frequency cap.
  private async checkPostDownloadNudge(userId: string): Promise<boolean> {
    const dismissed = await this.dismissalRepo.findActiveDismissal(
      userId,
      'post_download_nudge',
      MS_60_DAYS
    );
    return dismissed == null;
  }

  private async checkConvertSuccess(
    userId: string,
    objectId: string,
    jobType: string | null
  ): Promise<boolean> {
    if (!NOTION_JOB_TYPES.has(jobType ?? '')) {
      return false;
    }

    const dismissed = await this.dismissalRepo.findActiveDismissal(
      userId,
      'convert_success',
      MS_60_DAYS
    );
    if (dismissed != null) {
      return false;
    }

    const prior = await this.jobRepo.findPriorNotionJobByOwnerAndObjectId(
      userId,
      objectId,
      MS_90_DAYS
    );
    return prior != null;
  }

  private async checkAccountBanner(userId: string): Promise<boolean> {
    const dismissed = await this.dismissalRepo.findActiveDismissal(
      userId,
      'account_banner',
      MS_60_DAYS
    );
    if (dismissed != null) {
      return false;
    }

    const count = await this.jobRepo.countRecentNotionJobsByOwner(
      userId,
      MS_30_DAYS
    );
    return count > 1;
  }
}
