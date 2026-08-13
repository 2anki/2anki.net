import type { LifecycleRule } from '@aws-sdk/client-s3';

import {
  CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
  SetChatAttachmentsLifecycleUseCase,
} from './SetChatAttachmentsLifecycleUseCase';

class FakeLifecycleStorage {
  rules: LifecycleRule[] = [];
  failVerification = false;

  async getLifecycleRules(): Promise<LifecycleRule[]> {
    if (this.failVerification) return [];
    return this.rules;
  }

  async setLifecycleRules(rules: LifecycleRule[]): Promise<void> {
    this.rules = rules;
  }
}

describe('SetChatAttachmentsLifecycleUseCase', () => {
  it('adds the rule to an empty configuration', async () => {
    const storage = new FakeLifecycleStorage();
    const useCase = new SetChatAttachmentsLifecycleUseCase(storage);

    const result = await useCase.execute();

    expect(result).toEqual({
      ruleId: CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
      ruleCount: 1,
    });
    expect(storage.rules).toEqual([
      expect.objectContaining({
        ID: CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
        Status: 'Enabled',
        Filter: { Prefix: 'chat-attachments/' },
        Expiration: { Days: 90 },
      }),
    ]);
  });

  it('keeps unrelated rules and replaces only its own', async () => {
    const storage = new FakeLifecycleStorage();
    storage.rules = [
      { ID: 'expire-tmp-uploads', Status: 'Enabled' },
      {
        ID: CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
        Status: 'Disabled',
        Expiration: { Days: 7 },
      },
    ];
    const useCase = new SetChatAttachmentsLifecycleUseCase(storage);

    const result = await useCase.execute();

    expect(result.ruleCount).toBe(2);
    expect(storage.rules.map((rule) => rule.ID)).toEqual([
      'expire-tmp-uploads',
      CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID,
    ]);
    const ownRule = storage.rules.find(
      (rule) => rule.ID === CHAT_ATTACHMENTS_LIFECYCLE_RULE_ID
    );
    expect(ownRule).toMatchObject({
      Status: 'Enabled',
      Expiration: { Days: 90 },
    });
  });

  it('throws when the rule is missing after apply', async () => {
    const storage = new FakeLifecycleStorage();
    storage.failVerification = true;
    const useCase = new SetChatAttachmentsLifecycleUseCase(storage);

    await expect(useCase.execute()).rejects.toThrow(
      'Lifecycle rule missing after apply'
    );
  });
});
