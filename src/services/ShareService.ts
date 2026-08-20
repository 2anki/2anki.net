import { randomUUID } from 'node:crypto';
import DeckShares from '../data_layer/public/DeckShares';
import { IShareRepository } from '../data_layer/ShareRepository';
import { UsersId } from '../data_layer/public/Users';

class ShareService {
  constructor(private readonly repository: IShareRepository) {}

  async createShare(owner: UsersId, uploadKey: string): Promise<DeckShares> {
    const token = randomUUID();
    return this.repository.create(owner, uploadKey, token);
  }

  async findActiveShare(token: string): Promise<DeckShares | null> {
    const share = await this.repository.findByToken(token);
    if (share == null || share.revoked_at != null) {
      return null;
    }
    return share;
  }

  async findActiveShareForOwnerAndKey(
    owner: UsersId,
    uploadKey: string
  ): Promise<DeckShares | null> {
    return this.repository.findByOwnerAndKey(owner, uploadKey);
  }

  async findAllByOwner(owner: UsersId): Promise<DeckShares[]> {
    return this.repository.findAllByOwner(owner);
  }

  async revokeShare(token: string, owner: UsersId): Promise<boolean> {
    return this.repository.revoke(token, owner);
  }

  async recordView(share: DeckShares): Promise<void> {
    await this.repository.recordView(share.id);
  }

  buildShareUrl(token: string): string {
    const baseUrl = process.env.BASE_URL ?? 'https://2anki.net';
    return `${baseUrl}/s/${token}`;
  }
}

export default ShareService;
