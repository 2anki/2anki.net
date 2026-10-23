import { INotionRepository } from '../../data_layer/NotionRespository';
import { IEmailService } from '../../services/EmailService/EmailService';
import { track } from '../../services/events/track';

export type NotionTokenInvalidSource =
  | 'preview'
  | 'search'
  | 'database'
  | 'conversion'
  | 'ankify';

export interface IMarkNotionTokenInvalidUsers {
  getEmailById(id: string | number): Promise<string | undefined>;
}

export class MarkNotionTokenInvalidUseCase {
  constructor(
    private readonly notion: INotionRepository,
    private readonly users: IMarkNotionTokenInvalidUsers,
    private readonly email: IEmailService
  ) {}

  async execute(
    owner: number,
    source: NotionTokenInvalidSource
  ): Promise<void> {
    await this.notion.markTokenInvalid(owner);

    const claimed = await this.notion.setReconnectEmailSent(owner);
    if (!claimed) return;
    track('notion_token_invalidated', { userId: owner, props: { source } });

    const recipient = await this.users.getEmailById(owner);
    if (recipient == null) {
      console.warn('[notion-reconnect] no_email_on_file', {
        owner,
        reason: 'no_email_on_file',
      });
      return;
    }

    try {
      await this.email.sendNotionReconnectEmail(recipient);
    } catch (err) {
      console.warn('[notion-reconnect] email_send_failed', { owner });
    }
  }
}
