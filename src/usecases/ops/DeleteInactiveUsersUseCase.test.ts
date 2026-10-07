import { vi, type Mocked } from 'vitest';
import {
  DeleteInactiveUsersUseCase,
  IInactiveUserDeleter,
} from './DeleteInactiveUsersUseCase';
import { InMemoryInactivityEmailRepository } from '../../data_layer/InactivityEmailRepository';
import { InMemorySuppressionEventsRepository } from '../../data_layer/SuppressionEventsRepository';
import { emailHash } from '../../lib/emailHash';

function makeDeleter(
  overrides: Partial<IInactiveUserDeleter> = {}
): Mocked<IInactiveUserDeleter> {
  return {
    deleteUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Mocked<IInactiveUserDeleter>;
}

async function seedSuppression(
  suppression: InMemorySuppressionEventsRepository,
  email: string,
  eventType: 'bounce' | 'dropped' | 'deferred' = 'bounce'
): Promise<void> {
  await suppression.record({
    emailHash: emailHash(email),
    eventType,
    sgEventId: `evt-${email}-${eventType}`,
    eventAt: new Date('2026-06-06T10:00:00.000Z'),
  });
}

describe('DeleteInactiveUsersUseCase', () => {
  let repo: InMemoryInactivityEmailRepository;
  let suppression: InMemorySuppressionEventsRepository;

  beforeEach(() => {
    repo = new InMemoryInactivityEmailRepository();
    suppression = new InMemorySuppressionEventsRepository();
  });

  function makeUseCase(deleter: IInactiveUserDeleter) {
    return new DeleteInactiveUsersUseCase(repo, deleter, suppression);
  }

  describe('dry run', () => {
    it('returns candidate count without deleting anyone', async () => {
      repo.seedUsersToDelete([
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
      ]);
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(true);

      expect(result).toEqual({ count: 2, dryRun: true });
      expect(deleter.deleteUser).not.toHaveBeenCalled();
    });

    it('respects limit when counting candidates', async () => {
      repo.seedUsersToDelete([
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
        { id: 3, email: 'carol@example.com' },
      ]);
      const useCase = makeUseCase(makeDeleter());

      const result = await useCase.execute(true, 1);

      expect(result).toEqual({ count: 1, dryRun: true });
    });

    it('returns zero when no candidates exist', async () => {
      const useCase = makeUseCase(makeDeleter());

      const result = await useCase.execute(true);

      expect(result).toEqual({ count: 0, dryRun: true });
    });
  });

  describe('live delete', () => {
    it('deletes each candidate by id and counts successes', async () => {
      repo.seedUsersToDelete([
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
      ]);
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 2, dryRun: false });
      expect(deleter.deleteUser).toHaveBeenCalledWith('1');
      expect(deleter.deleteUser).toHaveBeenCalledWith('2');
      expect(deleter.deleteUser).toHaveBeenCalledTimes(2);
    });

    it('continues deleting remaining users when one deletion fails', async () => {
      repo.seedUsersToDelete([
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
      ]);
      const deleter = makeDeleter({
        deleteUser: vi
          .fn()
          .mockRejectedValueOnce(new Error('FK violation'))
          .mockResolvedValueOnce(undefined),
      });
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false);

      expect(result.count).toBe(1);
      expect(deleter.deleteUser).toHaveBeenCalledTimes(2);
    });

    it('deletes only up to the limit', async () => {
      repo.seedUsersToDelete([
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
        { id: 3, email: 'carol@example.com' },
      ]);
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false, 2);

      expect(result).toEqual({ count: 2, dryRun: false });
      expect(deleter.deleteUser).toHaveBeenCalledTimes(2);
    });

    it('returns zero when no candidates exist', async () => {
      const useCase = makeUseCase(makeDeleter());

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 0, dryRun: false });
    });
  });

  describe('dead-address segment', () => {
    it('deletes an inactive free account whose address hard-bounced even without a warning', async () => {
      repo.seedDeadAddressCandidates([{ id: 7, email: 'dead@example.com' }]);
      await seedSuppression(suppression, 'dead@example.com', 'bounce');
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 1, dryRun: false });
      expect(deleter.deleteUser).toHaveBeenCalledWith('7');
    });

    it('deletes an inactive free account whose address was dropped', async () => {
      repo.seedDeadAddressCandidates([{ id: 8, email: 'gone@example.com' }]);
      await seedSuppression(suppression, 'gone@example.com', 'dropped');
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 1, dryRun: false });
      expect(deleter.deleteUser).toHaveBeenCalledWith('8');
    });

    it('counts dead-address candidates in a dry run without deleting', async () => {
      repo.seedDeadAddressCandidates([{ id: 7, email: 'dead@example.com' }]);
      await seedSuppression(suppression, 'dead@example.com', 'bounce');
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(true);

      expect(result).toEqual({ count: 1, dryRun: true });
      expect(deleter.deleteUser).not.toHaveBeenCalled();
    });

    it('never deletes a candidate whose only suppression event is deferred', async () => {
      repo.seedDeadAddressCandidates([{ id: 7, email: 'slow@example.com' }]);
      await seedSuppression(suppression, 'slow@example.com', 'deferred');
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 0, dryRun: false });
      expect(deleter.deleteUser).not.toHaveBeenCalled();
    });

    it('never deletes a candidate with no suppression event at all', async () => {
      repo.seedDeadAddressCandidates([{ id: 7, email: 'fine@example.com' }]);
      const useCase = makeUseCase(makeDeleter());

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 0, dryRun: false });
    });

    it('does not double-count a user present in both segments', async () => {
      repo.seedUsersToDelete([{ id: 7, email: 'dead@example.com' }]);
      repo.seedDeadAddressCandidates([{ id: 7, email: 'dead@example.com' }]);
      await seedSuppression(suppression, 'dead@example.com', 'bounce');
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 1, dryRun: false });
      expect(deleter.deleteUser).toHaveBeenCalledTimes(1);
    });

    it('caps the combined segments at the batch limit', async () => {
      repo.seedUsersToDelete([
        { id: 1, email: 'a@example.com' },
        { id: 2, email: 'b@example.com' },
      ]);
      repo.seedDeadAddressCandidates([{ id: 3, email: 'c@example.com' }]);
      await seedSuppression(suppression, 'c@example.com', 'bounce');
      const deleter = makeDeleter();
      const useCase = makeUseCase(deleter);

      const result = await useCase.execute(false, 2);

      expect(result).toEqual({ count: 2, dryRun: false });
      expect(deleter.deleteUser).toHaveBeenCalledTimes(2);
    });
  });
});
