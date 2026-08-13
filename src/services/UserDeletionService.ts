import { chatAttachmentsUserPrefix } from '../lib/storage/chatAttachmentKeys';

export interface IUserDeletionRepository {
  deleteUser(owner: string): Promise<unknown>;
}

export interface IUserStorageSweeper {
  deleteByPrefix(prefix: string): Promise<number>;
}

// The single door for removing a user: account deletion, the inactive-user
// job, and the ops command all pass through here so the S3 sweep can never be
// forgotten by one of them. The sweep is best-effort — the bucket lifecycle
// rule reaps anything a failed sweep leaves, and a storage outage must not
// keep a user who asked to be deleted in the database.
export class UserDeletionService {
  constructor(
    private readonly usersRepository: IUserDeletionRepository,
    private readonly storage: IUserStorageSweeper
  ) {}

  async deleteUser(owner: string): Promise<unknown> {
    try {
      await this.storage.deleteByPrefix(
        chatAttachmentsUserPrefix(Number(owner))
      );
    } catch (error) {
      console.error(
        '[user-deletion] chat attachment sweep failed for user',
        owner,
        error
      );
    }
    return this.usersRepository.deleteUser(owner);
  }
}
