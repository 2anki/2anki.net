import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import {
  AnkiConnectClient,
  AnkiConnectUnreachableError,
} from '../../services/ankify/AnkiConnectClient';
import {
  GetAnkifyActiveProfileUseCase,
  NoActiveAnkifyClientForProfileError,
} from './GetAnkifyActiveProfileUseCase';

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

describe('GetAnkifyActiveProfileUseCase', () => {
  test('returns the active profile name from AnkiConnect', async () => {
    const ping = vi.fn(async () => 6);
    const getActiveProfile = vi.fn(async () => 'User 1');
    const factory = vi.fn(
      () => ({ ping, getActiveProfile }) as unknown as AnkiConnectClient
    );
    const useCase = new GetAnkifyActiveProfileUseCase(
      clientsRepo(activeClient),
      factory
    );

    const result = await useCase.execute(42);

    expect(result).toEqual({ profile: 'User 1' });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  test('throws when there is no active client', async () => {
    const useCase = new GetAnkifyActiveProfileUseCase(
      clientsRepo(null),
      vi.fn()
    );

    await expect(useCase.execute(42)).rejects.toBeInstanceOf(
      NoActiveAnkifyClientForProfileError
    );
  });

  test('propagates AnkiConnectUnreachableError to the caller', async () => {
    const ping = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const factory = vi.fn(() => ({ ping }) as unknown as AnkiConnectClient);
    const useCase = new GetAnkifyActiveProfileUseCase(
      clientsRepo(activeClient),
      factory
    );

    await expect(useCase.execute(42)).rejects.toBeInstanceOf(
      AnkiConnectUnreachableError
    );
  });
});
