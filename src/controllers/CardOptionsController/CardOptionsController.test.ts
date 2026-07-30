import { IServiceSettings } from '../../services/SettingsService';
import CardOptionsController from './CardOptionsController';
import { SettingsInitializer } from '../../data_layer/public/Settings';

const FLAT_OPTIONS = {
  deckName: 'My Custom Deck',
  template: 'specialstyle',
};

class FakeSettingsService implements IServiceSettings {
  public lastCreate: SettingsInitializer | null = null;

  create(settings: SettingsInitializer): Promise<number[]> {
    this.lastCreate = settings;
    return Promise.resolve([]);
  }
  delete(owner: string, id: string): Promise<void> {
    return Promise.resolve();
  }

  getById(owner: string, id: string): Promise<SettingsInitializer> {
    return Promise.resolve({
      object_id: id,
      owner,
      payload: FLAT_OPTIONS,
    });
  }

  getAllByOwner(
    owner: string
  ): Promise<
    { object_id: string; title: string | null; updated_at: Date | null }[]
  > {
    return Promise.resolve([
      {
        object_id: 'page-abc',
        title: 'Organic Chemistry',
        updated_at: new Date('2026-01-01'),
      },
      { object_id: 'page-xyz', title: null, updated_at: null },
    ]);
  }

  updateTitle(_object_id: string, _title: string): Promise<void> {
    return Promise.resolve();
  }
}

function testDefaultSettings(
  type: 'client' | 'server',
  expectedOptions: Record<string, string>
) {
  const settingsController = new CardOptionsController(
    new FakeSettingsService()
  );
  const defaultOptions = settingsController.getDefaultCardOptions(type);
  expect(defaultOptions).toStrictEqual(expectedOptions);
}

describe('CardOptionsController.findSetting', () => {
  function makeMockFindRes(owner = 'user-1') {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ send: jest.fn() });
    return {
      locals: { owner },
      json,
      status,
    } as unknown as import('express').Response;
  }

  it('returns the flat options for a new-shape row', async () => {
    const controller = new CardOptionsController(new FakeSettingsService());
    const req = {
      params: { id: 'page-123' },
    } as unknown as import('express').Request;
    const res = makeMockFindRes();
    await controller.findSetting(req, res);
    expect(res.json).toHaveBeenCalledWith({ payload: FLAT_OPTIONS });
  });

  it('unwraps a legacy wrapper row down to the flat options', async () => {
    class LegacyWrapperService extends FakeSettingsService {
      getById(_id: string): Promise<SettingsInitializer> {
        return Promise.resolve({
          object_id: '1',
          owner: '1',
          payload: {
            object_id: 'page-123',
            title: 'A',
            payload: FLAT_OPTIONS,
          },
        } as unknown as SettingsInitializer);
      }
    }
    const controller = new CardOptionsController(new LegacyWrapperService());
    const req = {
      params: { id: 'page-123' },
    } as unknown as import('express').Request;
    const res = makeMockFindRes();
    await controller.findSetting(req, res);
    expect(res.json).toHaveBeenCalledWith({ payload: FLAT_OPTIONS });
  });

  it('scopes the lookup to the authenticated owner', async () => {
    const getById = jest.fn().mockResolvedValue({
      object_id: 'page-123',
      owner: 'user-7',
      payload: FLAT_OPTIONS,
    });
    const service = new FakeSettingsService();
    service.getById = getById;
    const controller = new CardOptionsController(service);
    const req = {
      params: { id: 'page-123' },
    } as unknown as import('express').Request;
    const res = makeMockFindRes('user-7');
    await controller.findSetting(req, res);
    expect(getById).toHaveBeenCalledWith('user-7', 'page-123');
  });

  it('returns null payload when no settings are found', async () => {
    class EmptySettingsService extends FakeSettingsService {
      getById(_owner: string, _id: string): Promise<SettingsInitializer> {
        return Promise.resolve(null as unknown as SettingsInitializer);
      }
    }
    const controller = new CardOptionsController(new EmptySettingsService());
    const req = {
      params: { id: 'page-unknown' },
    } as unknown as import('express').Request;
    const res = makeMockFindRes();
    await controller.findSetting(req, res);
    expect(res.json).toHaveBeenCalledWith({ payload: null });
  });
});

describe('CardOptionsController.createSetting', () => {
  function makeMockCreateRes() {
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    return {
      locals: { owner: 'user-1' },
      status,
      send,
    } as unknown as import('express').Response;
  }

  it('persists the flat options map, not the request wrapper', async () => {
    const service = new FakeSettingsService();
    const controller = new CardOptionsController(service);
    const req = {
      params: { id: 'page-123' },
      body: {
        settings: {
          object_id: 'page-123',
          title: 'Pharmacology',
          payload: FLAT_OPTIONS,
        },
      },
    } as unknown as import('express').Request;
    const res = makeMockCreateRes();

    await controller.createSetting(req, res);

    expect(service.lastCreate).toEqual({
      owner: 'user-1',
      payload: FLAT_OPTIONS,
      object_id: 'page-123',
      title: 'Pharmacology',
    });
  });
});

describe('CardOptionsController.listSettings', () => {
  function makeMockRes(owner: string) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ send: jest.fn() });
    return {
      locals: { owner },
      json,
      status,
    } as unknown as import('express').Response;
  }

  it('returns items shaped as { pageId, updatedAt }', async () => {
    const controller = new CardOptionsController(new FakeSettingsService());
    const req = {} as import('express').Request;
    const res = makeMockRes('user-1');
    await controller.listSettings(req, res);
    expect(res.json).toHaveBeenCalledWith({
      items: [
        {
          pageId: 'page-abc',
          title: 'Organic Chemistry',
          updatedAt: new Date('2026-01-01').toISOString(),
        },
        { pageId: 'page-xyz', title: null, updatedAt: null },
      ],
    });
  });
});

describe('CardOptionsController.deleteAllUserSettings', () => {
  function makeMockRes(owner: string) {
    const json = jest.fn();
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    return {
      locals: { owner },
      json,
      send,
      status,
    } as unknown as import('express').Response;
  }

  it('returns 204 when use case resolves', async () => {
    const mockUseCase = { execute: jest.fn().mockResolvedValue(undefined) };
    const controller = new CardOptionsController(
      new FakeSettingsService(),
      undefined,
      mockUseCase as any
    );
    const req = {} as import('express').Request;
    const res = makeMockRes('user-1');
    await controller.deleteAllUserSettings(req, res);
    expect(mockUseCase.execute).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 500 when use case throws', async () => {
    const mockUseCase = {
      execute: jest.fn().mockRejectedValue(new Error('DB down')),
    };
    const controller = new CardOptionsController(
      new FakeSettingsService(),
      undefined,
      mockUseCase as any
    );
    const req = {} as import('express').Request;
    const res = makeMockRes('user-1');
    await controller.deleteAllUserSettings(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('SettingsController', () => {
  test('returns default settings for client', () => {
    testDefaultSettings('client', {
      'add-notion-link': 'false',
      'use-notion-id': 'true',
      'block-id-identity': 'false',
      all: 'true',
      paragraph: 'false',
      cherry: 'false',
      avocado: 'false',
      'claude-ai-flashcards': 'false',
      'ai-comprehensive': 'false',
      tags: 'true',
      'section-tags': 'false',
      cloze: 'true',
      'cloze-from-toggle-content': 'false',
      'group-cloze-per-toggle': 'false',
      'enable-input': 'false',
      'basic-reversed': 'false',
      reversed: 'false',
      'no-underline': 'false',
      'max-one-toggle-per-card': 'true',
      'remove-mp3-links': 'false',
      'perserve-newlines': 'false',
      'process-pdfs': 'true',
      'pdf-extract-text': 'false',
      'pdf-page-pairs': 'false',
      'download-pdfs': 'false',
      'markdown-nested-bullet-points': 'true',
      'split-sections-into-decks': 'false',
      'vertex-ai-pdf-questions': 'false',
      'disable-indented-bullets': 'false',
      'image-quiz-html-to-anki': 'false',
      'embed-images': 'true',
      'share-files-for-debugging': 'false',
    });
  });

  test('returns default settings for server', () => {
    testDefaultSettings('server', {
      'global-tags': '',
      'add-notion-link': 'false',
      'use-notion-id': 'true',
      'block-id-identity': 'false',
      all: 'true',
      paragraph: 'false',
      cherry: 'false',
      avocado: 'false',
      'claude-ai-flashcards': 'false',
      'ai-comprehensive': 'false',
      tags: 'true',
      'section-tags': 'false',
      cloze: 'true',
      'cloze-from-toggle-content': 'false',
      'group-cloze-per-toggle': 'false',
      'enable-input': 'false',
      'basic-reversed': 'false',
      reversed: 'false',
      'no-underline': 'false',
      'max-one-toggle-per-card': 'true',
      'remove-mp3-links': 'false',
      'perserve-newlines': 'false',
      'process-pdfs': 'true',
      'pdf-extract-text': 'false',
      'pdf-page-pairs': 'false',
      'download-pdfs': 'false',
      'page-emoji': 'first_emoji',
      'image-quiz-html-to-anki': 'false',
      'embed-images': 'true',
      'markdown-nested-bullet-points': 'true',
      'split-sections-into-decks': 'false',
      'vertex-ai-pdf-questions': 'false',
      'disable-indented-bullets': 'false',
      'share-files-for-debugging': 'false',
      'mcq-enabled': 'false',
      'mcq-tts-question': '',
      'mcq-tts-correct-answer': '',
      'mcq-tts-extra': '',
      'tts-auto-detect': 'false',
      'tts-manual-lang': '',
      'tts-manual-side': 'front',
      'overlapping-cloze': 'off',
      'code-theme': 'github',
    });
  });
});
