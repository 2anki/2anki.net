import { vi } from 'vitest';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySyncMappingsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncMappingsRepository';
import { AnkifySyncConflictsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncConflictsRepository';
import { AnkifyNotionSubscriptionsRepositoryInterface } from '../../data_layer/ankify/AnkifyNotionSubscriptionsRepository';
import { AnkifySyncLogsRepositoryInterface } from '../../data_layer/ankify/AnkifySyncLogsRepository';
import { INotionRepository } from '../../data_layer/NotionRespository';
import {
  AnkifyClient,
  AnkifyNotionSubscription,
  AnkifySyncConflict,
  AnkifySyncMapping,
  NewAnkifySyncMapping,
} from '../../entities/ankify';
import { ResolveConflictUseCase } from './ResolveConflictUseCase';

const buildClient = (): AnkifyClient => ({
  id: 7,
  owner: 99,
  container_id: 'container',
  container_name: null,
  anki_port: 8765,
  vnc_port: 5900,
  novnc_port: 6080,
  anki_connect_api_key: null,
  status: 'active',
  created_at: new Date(),
  last_active_at: new Date(),
});

const buildConflict = (
  overrides: Partial<AnkifySyncConflict> = {}
): AnkifySyncConflict => ({
  id: 1,
  owner: 99,
  ankify_client_id: 7,
  subscription_id: 55,
  source_id: 'block-abc',
  anki_note_id: 1234,
  kind: 'both_edited',
  notion_last_edited_at: null,
  anki_modified_at: null,
  notion_snapshot: { front: 'N front', back: 'N back' },
  anki_snapshot: { front: 'A front', back: 'A back' },
  status: 'pending',
  resolution: null,
  created_at: new Date(),
  resolved_at: null,
  ...overrides,
});

const buildSubscription = (
  overrides: Partial<AnkifyNotionSubscription> = {}
): AnkifyNotionSubscription => ({
  id: 55,
  owner: 99,
  ankify_client_id: 7,
  notion_page_id: 'page-1',
  notion_page_title: 'Pharmacology',
  notion_page_url: null,
  notion_page_icon: null,
  target_deck: null,
  enabled: true,
  last_polled_at: null,
  last_synced_at: null,
  last_error: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

interface Harness {
  useCase: ResolveConflictUseCase;
  upserted: NewAnkifySyncMapping[];
}

const buildHarness = (
  subscription: AnkifyNotionSubscription | null
): Harness => {
  const upserted: NewAnkifySyncMapping[] = [];

  const clients: AnkifyClientsRepositoryInterface = {
    create: vi.fn(),
    findActiveById: vi.fn(),
    findActiveByOwner: vi.fn().mockResolvedValue(buildClient()),
    setStatus: vi.fn(),
    deleteById: vi.fn(),
    touchLastActiveAt: vi.fn(),
    listUsedPorts: vi.fn(),
  } as unknown as AnkifyClientsRepositoryInterface;

  const mappings: AnkifySyncMappingsRepositoryInterface = {
    upsert: vi.fn(async (input: NewAnkifySyncMapping) => {
      upserted.push(input);
      return { id: 1, ...input } as unknown as AnkifySyncMapping;
    }),
  } as unknown as AnkifySyncMappingsRepositoryInterface;

  const conflicts: AnkifySyncConflictsRepositoryInterface = {
    findById: vi.fn().mockResolvedValue(buildConflict()),
    resolve: vi.fn().mockResolvedValue(undefined),
  } as unknown as AnkifySyncConflictsRepositoryInterface;

  const subscriptions: AnkifyNotionSubscriptionsRepositoryInterface = {
    findById: vi.fn().mockResolvedValue(subscription),
  } as unknown as AnkifyNotionSubscriptionsRepositoryInterface;

  const logs: AnkifySyncLogsRepositoryInterface = {
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as AnkifySyncLogsRepositoryInterface;

  const notionRepo = {} as unknown as INotionRepository;

  const ankiConnect = vi.fn().mockReturnValue({
    updateNoteFields: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(null),
  });

  const notionUpdater = vi.fn();

  const useCase = new ResolveConflictUseCase(
    clients,
    mappings,
    conflicts,
    subscriptions,
    logs,
    notionRepo,
    ankiConnect as never,
    notionUpdater as never
  );

  return { useCase, upserted };
};

describe('ResolveConflictUseCase deck name', () => {
  it('records the subscription target_deck when one is set', async () => {
    const { useCase, upserted } = buildHarness(
      buildSubscription({ target_deck: 'Medicine::Cardiology' })
    );

    await useCase.execute({ id: 1, owner: 99, resolution: 'keep_notion' });

    expect(upserted).toHaveLength(1);
    expect(upserted[0].deck_name).toBe('Medicine::Cardiology');
  });

  it('falls back to Notion Sync plus the page title when no target deck is set', async () => {
    const { useCase, upserted } = buildHarness(
      buildSubscription({
        target_deck: null,
        notion_page_title: 'Pharmacology',
      })
    );

    await useCase.execute({ id: 1, owner: 99, resolution: 'keep_notion' });

    expect(upserted).toHaveLength(1);
    expect(upserted[0].deck_name).toBe('Notion Sync::Pharmacology');
  });

  it('falls back to Notion Sync plus Untitled when the subscription is missing', async () => {
    const { useCase, upserted } = buildHarness(null);

    await useCase.execute({ id: 1, owner: 99, resolution: 'keep_notion' });

    expect(upserted).toHaveLength(1);
    expect(upserted[0].deck_name).toBe('Notion Sync::Untitled');
  });
});
