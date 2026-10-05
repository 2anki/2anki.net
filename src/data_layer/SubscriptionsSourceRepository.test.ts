import { vi } from 'vitest';
import { Knex } from 'knex';
import {
  SubscriptionsSourceRepository,
  InMemorySubscriptionsSourceRepository,
} from './SubscriptionsSourceRepository';

describe('SubscriptionsSourceRepository', () => {
  it('selects the payload column from the subscriptions table and maps the rows', async () => {
    const select = vi.fn(async () => [
      { payload: { id: 'sub_1' } },
      { payload: '{"id":"sub_2"}' },
    ]);
    const table = vi.fn(() => ({ select }));
    const repo = new SubscriptionsSourceRepository(table as unknown as Knex);

    const payloads = await repo.listPayloads();

    expect(table).toHaveBeenCalledWith('subscriptions');
    expect(select).toHaveBeenCalledWith('payload');
    expect(payloads).toEqual([{ id: 'sub_1' }, '{"id":"sub_2"}']);
  });
});

describe('InMemorySubscriptionsSourceRepository', () => {
  it('returns the payloads it was constructed with', async () => {
    const repo = new InMemorySubscriptionsSourceRepository([{ id: 'a' }]);
    expect(await repo.listPayloads()).toEqual([{ id: 'a' }]);
  });

  it('defaults to an empty list', async () => {
    const repo = new InMemorySubscriptionsSourceRepository();
    expect(await repo.listPayloads()).toEqual([]);
  });
});
