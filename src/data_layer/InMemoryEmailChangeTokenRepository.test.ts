import InMemoryEmailChangeTokenRepository from './InMemoryEmailChangeTokenRepository';
import type { UsersId } from './public/Users';

const userId = 42 as UsersId;

const seed = () => ({
  user_id: userId,
  new_email: 'new@example.com',
  token_hash: 'hash-1',
  expires_at: new Date(Date.now() + 30 * 60 * 1000),
});

describe('InMemoryEmailChangeTokenRepository', () => {
  it('returns an inserted row by its token hash', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    const inserted = await repo.insert(seed());

    const found = await repo.findByTokenHash('hash-1');

    expect(found).toMatchObject({
      id: inserted.id,
      new_email: 'new@example.com',
      token_hash: 'hash-1',
      consumed_at: null,
    });
  });

  it('returns null once a token is consumed via findLivePendingByUser', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    const inserted = await repo.insert(seed());

    await repo.markConsumed(Number(inserted.id));

    const pending = await repo.findLivePendingByUser(
      Number(userId),
      new Date()
    );
    expect(pending).toBeNull();
  });

  it('excludes expired tokens from the live pending lookup', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await repo.insert({
      ...seed(),
      token_hash: 'expired',
      expires_at: new Date(Date.now() - 1000),
    });

    const pending = await repo.findLivePendingByUser(
      Number(userId),
      new Date()
    );
    expect(pending).toBeNull();
  });

  it('deletes only live pending rows for the owner', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await repo.insert(seed());
    const consumed = await repo.insert({ ...seed(), token_hash: 'hash-2' });
    await repo.markConsumed(Number(consumed.id));

    const deleted = await repo.deleteLivePendingByUser(Number(userId));

    expect(deleted).toBe(1);
    expect(await repo.findByTokenHash('hash-1')).toBeNull();
    expect(await repo.findByTokenHash('hash-2')).not.toBeNull();
  });

  it('counts only rows created since the cutoff', async () => {
    const repo = new InMemoryEmailChangeTokenRepository();
    await repo.insert({
      ...seed(),
      token_hash: 'old',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    await repo.insert({ ...seed(), token_hash: 'recent' });

    const count = await repo.countRecentByUser(
      Number(userId),
      new Date(Date.now() - 60 * 60 * 1000)
    );
    expect(count).toBe(1);
  });
});
