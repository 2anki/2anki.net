import { vi } from 'vitest';
import {
  ConflictNotFoundForOpenError,
  OpenConflictInAnkiUseCase,
} from './OpenConflictInAnkiUseCase';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySyncConflictsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncConflictsRepository';
import {
  AnkiConnectClient,
  AnkiConnectUnreachableError,
} from '../../services/ankify/AnkiConnectClient';
import { AnkifySyncConflict } from '../../entities/ankify';

const sampleConflict = (
  overrides: Partial<AnkifySyncConflict> = {}
): AnkifySyncConflict =>
  ({
    id: 7,
    owner: 42,
    ankify_client_id: 1,
    subscription_id: null,
    source_id: 'block-id',
    anki_note_id: 1502298033753,
    kind: 'both_edited',
    notion_last_edited_at: null,
    anki_modified_at: null,
    notion_snapshot: { front: 'a', back: 'b' },
    anki_snapshot: { front: 'c', back: 'd' },
    status: 'pending',
    resolution: null,
    resolved_at: null,
    created_at: new Date(),
    ...overrides,
  }) as AnkifySyncConflict;

const activeClient = {
  id: 1,
  anki_port: 8765,
  anki_connect_api_key: null,
} as Awaited<ReturnType<AnkifyClientsRepositoryInterface['findActiveByOwner']>>;

const makeConflicts = (
  conflict: AnkifySyncConflict | null
): AnkifySyncConflictsRepositoryInterface =>
  ({
    findById: vi.fn(async () => conflict),
  }) as unknown as AnkifySyncConflictsRepositoryInterface;

const makeClients = (
  client: Awaited<
    ReturnType<AnkifyClientsRepositoryInterface['findActiveByOwner']>
  >
): AnkifyClientsRepositoryInterface =>
  ({
    findActiveByOwner: vi.fn(async () => client),
  }) as unknown as AnkifyClientsRepositoryInterface;

describe('OpenConflictInAnkiUseCase', () => {
  test('opens the owned conflict note via guiBrowse with nid: query', async () => {
    const guiBrowse = vi.fn(async () => [1]);
    const ping = vi.fn(async () => 6);
    const client = makeClients(activeClient);
    const conflicts = makeConflicts(sampleConflict());
    const factory = vi.fn(
      () => ({ ping, guiBrowse }) as unknown as AnkiConnectClient
    );

    const useCase = new OpenConflictInAnkiUseCase(client, conflicts, factory);
    const result = await useCase.execute({ id: 7, owner: 42 });

    expect(result).toEqual({ opened: true });
    expect(conflicts.findById).toHaveBeenCalledWith(7, 42);
    expect(guiBrowse).toHaveBeenCalledWith('nid:1502298033753');
  });

  test('returns opened false without calling guiBrowse when the client is offline', async () => {
    const guiBrowse = vi.fn(async () => [1]);
    const ping = vi.fn(async () => {
      throw new AnkiConnectUnreachableError('http://x', new Error('down'));
    });
    const useCase = new OpenConflictInAnkiUseCase(
      makeClients(activeClient),
      makeConflicts(sampleConflict()),
      vi.fn(() => ({ ping, guiBrowse }) as unknown as AnkiConnectClient)
    );

    const result = await useCase.execute({ id: 7, owner: 42 });

    expect(result).toEqual({ opened: false });
    expect(guiBrowse).not.toHaveBeenCalled();
  });

  test('returns opened false when the user has no active client', async () => {
    const guiBrowse = vi.fn(async () => [1]);
    const useCase = new OpenConflictInAnkiUseCase(
      makeClients(null),
      makeConflicts(sampleConflict()),
      vi.fn(
        () => ({ ping: vi.fn(), guiBrowse }) as unknown as AnkiConnectClient
      )
    );

    const result = await useCase.execute({ id: 7, owner: 42 });

    expect(result).toEqual({ opened: false });
    expect(guiBrowse).not.toHaveBeenCalled();
  });

  test('throws when the conflict is not owned by the requester', async () => {
    const useCase = new OpenConflictInAnkiUseCase(
      makeClients(activeClient),
      makeConflicts(null),
      vi.fn()
    );

    await expect(useCase.execute({ id: 99, owner: 42 })).rejects.toBeInstanceOf(
      ConflictNotFoundForOpenError
    );
  });
});
