import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import {
  AnkiConnectClient,
  AnkiConnectUnreachableError,
} from '../../services/ankify/AnkiConnectClient';
import {
  DeckNotOwnedError,
  OpenDeckInAnkiUseCase,
} from './OpenDeckInAnkiUseCase';

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

const subsRepo = (
  rows: { target_deck: string | null; notion_page_title: string | null }[]
): AnkifyNotionSubscriptionsRepositoryInterface =>
  ({
    listByOwner: vi.fn(async () => rows),
  }) as unknown as AnkifyNotionSubscriptionsRepositoryInterface;

describe('OpenDeckInAnkiUseCase', () => {
  test('jumps Anki to an owned deck and returns opened', async () => {
    const ping = vi.fn(async () => 6);
    const guiDeckOverview = vi.fn(async () => true);
    const factory = vi.fn(
      () => ({ ping, guiDeckOverview }) as unknown as AnkiConnectClient
    );
    const useCase = new OpenDeckInAnkiUseCase(
      clientsRepo(activeClient),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      factory
    );

    const result = await useCase.execute({ owner: 42, deck: 'MS3::Pharma' });

    expect(result).toEqual({ opened: true });
    expect(guiDeckOverview).toHaveBeenCalledWith('MS3::Pharma');
  });

  test('rejects a deck the user does not own without touching AnkiConnect', async () => {
    const factory = vi.fn();
    const useCase = new OpenDeckInAnkiUseCase(
      clientsRepo(activeClient),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, deck: 'Default' })
    ).rejects.toBeInstanceOf(DeckNotOwnedError);
    expect(factory).not.toHaveBeenCalled();
  });

  test('returns opened false when there is no active client', async () => {
    const useCase = new OpenDeckInAnkiUseCase(
      clientsRepo(null),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      vi.fn()
    );

    const result = await useCase.execute({ owner: 42, deck: 'MS3::Pharma' });

    expect(result).toEqual({ opened: false });
  });

  test('propagates AnkiConnectUnreachableError', async () => {
    const ping = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const factory = vi.fn(() => ({ ping }) as unknown as AnkiConnectClient);
    const useCase = new OpenDeckInAnkiUseCase(
      clientsRepo(activeClient),
      subsRepo([{ target_deck: 'MS3::Pharma', notion_page_title: null }]),
      factory
    );

    await expect(
      useCase.execute({ owner: 42, deck: 'MS3::Pharma' })
    ).rejects.toBeInstanceOf(AnkiConnectUnreachableError);
  });
});
