import type { LifecycleRule } from '@aws-sdk/client-s3';

import {
  CHAT_ATTACHMENTS_PREFIX,
  CHAT_ATTACHMENT_RETENTION_DAYS,
} from '../../lib/storage/chatAttachmentKeys';

export const CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID = 'expire-chat-attachments-90d';

const CHAT_ATTACHMENTS_LIFECYCLE_RULE: LifecycleRule = {
  ID: CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
  Status: 'Enabled',
  Filter: { Prefix: CHAT_ATTACHMENTS_PREFIX },
  Expiration: { Days: CHAT_ATTACHMENT_RETENTION_DAYS },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
};

export interface ILifecycleRuleStorage {
  getLifecycleRules(): Promise<LifecycleRule[]>;
  setLifecycleRules(rules: LifecycleRule[]): Promise<void>;
}

export interface SetChatAttachmentsLifecycleResult {
  ruleId: string;
  ruleCount: number;
}

export class SetChatAttachmentsLifecycleUseCase {
  constructor(private readonly storage: ILifecycleRuleStorage) {}

  async execute(): Promise<SetChatAttachmentsLifecycleResult> {
    const existing = await this.storage.getLifecycleRules();
    const merged = [
      ...existing.filter(
        (rule) => rule.ID !== CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID
      ),
      CHAT_ATTACHMENTS_LIFECYCLE_RULE,
    ];
    await this.storage.setLifecycleRules(merged);

    const verified = await this.storage.getLifecycleRules();
    const applied = verified.some(
      (rule) => rule.ID === CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID
    );
    if (!applied) {
      throw new Error('Lifecycle rule missing after apply');
    }
    return {
      ruleId: CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
      ruleCount: verified.length,
    };
  }
}
