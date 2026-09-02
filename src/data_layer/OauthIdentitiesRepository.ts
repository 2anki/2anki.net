import { Knex } from 'knex';

import hashToken from '../lib/misc/hashToken';
import unHashToken from '../lib/misc/unHashToken';
import OauthIdentities, {
  OauthIdentitiesInitializer,
} from './public/OauthIdentities';
import { UsersId } from './public/Users';

class OauthIdentitiesRepository {
  private table = 'oauth_identities';

  constructor(private database: Knex) {}

  async findByProviderAndSubject(
    provider: string,
    subject: string
  ): Promise<OauthIdentities | null> {
    const row: OauthIdentities | undefined = await this.database(this.table)
      .where({ provider, subject })
      .first();
    return row ?? null;
  }

  async link(
    provider: string,
    subject: string,
    userId: UsersId,
    refreshToken?: string
  ): Promise<void> {
    const row: OauthIdentitiesInitializer = {
      provider,
      subject,
      user_id: userId,
      refresh_token: refreshToken ? hashToken(refreshToken) : null,
    };
    await this.database(this.table).insert(row);
  }

  async updateRefreshToken(
    provider: string,
    subject: string,
    refreshToken: string
  ): Promise<void> {
    await this.database(this.table)
      .where({ provider, subject })
      .update({ refresh_token: hashToken(refreshToken) });
  }

  async hasIdentityForUser(userId: number): Promise<boolean> {
    const row = await this.database(this.table)
      .where({ user_id: userId })
      .first();
    return row != null;
  }

  async findRefreshTokenByUserAndProvider(
    userId: UsersId,
    provider: string
  ): Promise<string | null> {
    const row: Pick<OauthIdentities, 'refresh_token'> | undefined =
      await this.database(this.table)
        .where({ user_id: userId, provider })
        .select('refresh_token')
        .first();
    return row?.refresh_token ? unHashToken(row.refresh_token) : null;
  }
}

export default OauthIdentitiesRepository;
