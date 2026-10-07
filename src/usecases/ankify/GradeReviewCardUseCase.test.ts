import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkiConnectClient } from '../../services/ankify/AnkiConnectClient';
import {
  GradeReviewCardUseCase,
  InvalidReviewEaseError,
  NoActiveAnkifyClientForReviewError,
  ReviewCardNotFoundError,
} from './GradeReviewCardUseCase';

const activeClient = {
  id: 1,
  owner: 42,
  anki_port: 8765,
  anki_connect_api_key: 'k',
} as unknown as Awaited<
  ReturnType<AnkifyClientsRepositoryInterface['findActiveByOwner']>
>;

const clientsRepo = (
  client: Awaited<
    ReturnType<AnkifyClientsRepositoryInterface['findActiveByOwner']>
  >
): AnkifyClientsRepositoryInterface =>
  ({
    findActiveByOwner: vi.fn(async () => client),
  }) as unknown as AnkifyClientsRepositoryInterface;

describe('GradeReviewCardUseCase', () => {
  it.each([0, 5, 1.5, '3', NaN])(
    'rejects ease %p with InvalidReviewEaseError and never calls AnkiConnect',
    async (ease) => {
      const findActiveByOwner = vi.fn();
      const factory = vi.fn();
      const useCase = new GradeReviewCardUseCase(
        {
          findActiveByOwner,
        } as unknown as AnkifyClientsRepositoryInterface,
        factory
      );

      await expect(
        useCase.execute({
          owner: 42,
          cardId: 9001,
          ease: ease as unknown as number,
        })
      ).rejects.toBeInstanceOf(InvalidReviewEaseError);
      expect(findActiveByOwner).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    }
  );

  it('grades the card after the cid existence probe passes', async () => {
    const findCards = vi.fn(async () => [9001]);
    const answerCards = vi.fn(async () => [true]);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          answerCards,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GradeReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute({ owner: 42, cardId: 9001, ease: 3 });

    expect(result).toEqual({ graded: true });
    expect(findCards).toHaveBeenCalledWith('cid:9001');
    expect(answerCards).toHaveBeenCalledTimes(1);
    expect(answerCards).toHaveBeenCalledWith([{ cardId: 9001, ease: 3 }]);
  });

  it('rejects a cardId that does not exist and never grades', async () => {
    const findCards = vi.fn(async () => []);
    const answerCards = vi.fn(async () => [true]);
    const factory = vi.fn(
      () =>
        ({
          ping: vi.fn(async () => 6),
          findCards,
          answerCards,
        }) as unknown as AnkiConnectClient
    );
    const useCase = new GradeReviewCardUseCase(
      clientsRepo(activeClient),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, cardId: 1234567, ease: 4 })
    ).rejects.toBeInstanceOf(ReviewCardNotFoundError);
    expect(findCards).toHaveBeenCalledWith('cid:1234567');
    expect(answerCards).not.toHaveBeenCalled();
  });

  it('throws when there is no active client (offline)', async () => {
    const useCase = new GradeReviewCardUseCase(clientsRepo(null), vi.fn());

    await expect(
      useCase.execute({ owner: 42, cardId: 9001, ease: 3 })
    ).rejects.toBeInstanceOf(NoActiveAnkifyClientForReviewError);
  });
});
