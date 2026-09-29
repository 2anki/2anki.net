import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import {
  ClaimHeldDeckUseCase,
  HeldDeckExpiredError,
  NoHeldDeckError,
  type HeldDeckConversion,
  type HeldDeckConverter,
  type HeldFileStore,
} from './ClaimHeldDeckUseCase';

const ANON = 'anon-claim-1';
const OWNER = '4242';

function buildStore(body: Buffer | null = Buffer.from('<html></html>')) {
  const getFileContents = jest
    .fn()
    .mockResolvedValue({ Body: body ?? undefined });
  const store: HeldFileStore = { getFileContents };
  return { store, getFileContents };
}

function buildConverter(
  result: HeldDeckConversion = {
    downloadKey: 'owner-key.apkg',
    cardCount: 34,
    cardsHeldBack: 0,
    deckName: 'study-notes',
  }
) {
  const convertHeldFileForOwner = jest.fn().mockResolvedValue(result);
  const converter: HeldDeckConverter = { convertHeldFileForOwner };
  return { converter, convertHeldFileForOwner };
}

async function seedHold(
  repo: InMemoryHeldDeckRepository,
  overrides: { expiresAt?: Date; anonId?: string } = {}
) {
  return repo.insert({
    claimKey: 'claim-key',
    storageKey: 'held/abc.html',
    anonId: overrides.anonId ?? ANON,
    filename: 'study-notes.html',
    cardCount: 21,
    cardsHeldBack: 13,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
  });
}

describe('ClaimHeldDeckUseCase', () => {
  it('404s (NoHeldDeckError) when the visitor has no hold', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
  });

  it('404s when there is no anonymous id to bind the claim to', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: null,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(NoHeldDeckError);
  });

  it('410s (HeldDeckExpiredError) when the only hold has expired', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, { expiresAt: new Date(Date.now() - 60_000) });
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
  });

  it('converts the held file as the claimant and stamps the claim on the first claim', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const { store, getFileContents } = buildStore();
    const { converter, convertHeldFileForOwner } = buildConverter();
    const useCase = new ClaimHeldDeckUseCase(repo, store, converter);

    const result = await useCase.execute({
      anonId: ANON,
      owner: OWNER,
      paying: false,
      requestId: 'req-1',
    });

    expect(result).toEqual({
      downloadKey: 'owner-key.apkg',
      cardCount: 34,
      cardsHeldBack: 0,
      deckName: 'study-notes',
    });
    expect(getFileContents).toHaveBeenCalledWith('held/abc.html');
    expect(convertHeldFileForOwner).toHaveBeenCalledTimes(1);
    const [owner, file, paying, source, requestId] =
      convertHeldFileForOwner.mock.calls[0];
    expect(owner).toBe(OWNER);
    expect(file).toMatchObject({ originalname: 'study-notes.html' });
    expect(paying).toBe(false);
    expect(source).toBeNull();
    expect(requestId).toBe('req-1');
    expect(repo.rows[0].claimed_at).not.toBeNull();
    expect(repo.rows[0].claimed_by).toBe(4242);
  });

  it('410s on a second claim once the hold is already claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    await useCase.execute({
      anonId: ANON,
      owner: OWNER,
      paying: false,
      requestId: undefined,
    });

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
  });

  it('410s when the stored source object is already gone', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore(null).store,
      buildConverter().converter
    );

    await expect(
      useCase.execute({
        anonId: ANON,
        owner: OWNER,
        paying: false,
        requestId: undefined,
      })
    ).rejects.toBeInstanceOf(HeldDeckExpiredError);
  });

  it('peek returns the claimable hold counts, or null when none is claimable', async () => {
    const repo = new InMemoryHeldDeckRepository();
    const useCase = new ClaimHeldDeckUseCase(
      repo,
      buildStore().store,
      buildConverter().converter
    );

    expect(await useCase.peek(ANON)).toBeNull();
    await seedHold(repo);
    expect(await useCase.peek(ANON)).toEqual({
      cardCount: 21,
      cardsHeldBack: 13,
    });
    expect(await useCase.peek(null)).toBeNull();
  });
});
