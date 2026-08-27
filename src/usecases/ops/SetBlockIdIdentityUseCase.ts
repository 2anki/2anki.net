import type { IUserPreferencesRepository } from '../../data_layer/UserPreferencesRepository';

export interface UsersByEmailLookup {
  getByEmail(email: string): Promise<{ id: number | string } | undefined>;
}

export interface SetBlockIdIdentityInput {
  email: string;
  enabled: boolean;
}

export type SetBlockIdIdentityOutcome =
  | { success: true; userId: number; blockIdIdentity: boolean }
  | { success: false; reason: 'user_not_found' };

export class SetBlockIdIdentityUseCase {
  constructor(
    private readonly usersRepo: UsersByEmailLookup,
    private readonly preferencesRepo: Pick<
      IUserPreferencesRepository,
      'setBlockIdIdentity'
    >
  ) {}

  async execute(
    input: SetBlockIdIdentityInput
  ): Promise<SetBlockIdIdentityOutcome> {
    const user = await this.usersRepo.getByEmail(input.email);
    if (user == null) {
      return { success: false, reason: 'user_not_found' };
    }
    const userId = Number(user.id);
    await this.preferencesRepo.setBlockIdIdentity(userId, input.enabled);
    return { success: true, userId, blockIdIdentity: input.enabled };
  }
}
