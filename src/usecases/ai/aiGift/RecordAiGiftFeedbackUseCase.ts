import sanitizeHtml from 'sanitize-html';
import { track } from '../../../services/events/track';
import { withServerMarker } from '../../../lib/events/serverEventProps';
import { AI_GIFT_FEEDBACK_EVENT, type AiGiftDeps } from './aiGiftDeps';

export const AI_GIFT_FEEDBACK_MAX_CHARS = 500;

// track() drops an event whose props serialize past 1024 bytes, so the comment
// is trimmed until its JSON form leaves room for the other props.
const COMMENT_JSON_BUDGET = 800;

export type AiGiftFeedbackAnswer = 'yes' | 'no' | 'dismissed';

export type RecordAiGiftFeedbackResult =
  | { ok: true }
  | { ok: false; reason: 'no_gift' | 'already_answered' };

export function cleanGiftFeedbackComment(raw: string): string {
  const text = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
    .replaceAll(/\s+/g, ' ')
    .trim();
  let comment = Array.from(text).slice(0, AI_GIFT_FEEDBACK_MAX_CHARS).join('');
  while (JSON.stringify(comment).length > COMMENT_JSON_BUDGET) {
    comment = Array.from(comment).slice(0, -10).join('');
  }
  return comment;
}

export class RecordAiGiftFeedbackUseCase {
  constructor(private readonly deps: AiGiftDeps) {}

  async execute(input: {
    userId: number;
    answer: AiGiftFeedbackAnswer;
    comment: string;
  }): Promise<RecordAiGiftFeedbackResult> {
    const grant = await this.deps.gifts.findGrant(input.userId);
    if (grant == null) {
      return { ok: false, reason: 'no_gift' };
    }
    if ((await this.deps.feedbackCount(input.userId)) > 0) {
      return { ok: false, reason: 'already_answered' };
    }
    const comment =
      input.answer === 'no' ? cleanGiftFeedbackComment(input.comment) : '';
    track(AI_GIFT_FEEDBACK_EVENT, {
      userId: input.userId,
      props: withServerMarker({
        gift_id: grant.id,
        answer: input.answer,
        ...(comment === '' ? {} : { comment }),
      }),
    });
    return { ok: true };
  }
}
