import { vi, type Mock } from 'vitest';
import { ensureAnkifyModels } from './ensureAnkifyModels';
import { ANKIFY_BASIC_MODEL, ANKIFY_CLOZE_MODEL } from './ankifyModels';
import { AnkiConnectClient } from './AnkiConnectClient';
import { AnkifyTemplateOverrides } from './templateOverrides';
import { TemplateFile } from '../../lib/parser/Settings/types';

const makeStub = (modelNames: string[]) => {
  const stub = {
    modelNames: vi.fn(async () => modelNames),
    createModel: vi.fn(async () => ({ id: 1 })),
  };
  return stub as unknown as AnkiConnectClient & typeof stub;
};

describe('ensureAnkifyModels', () => {
  test('creates both Ankify models when AnkiConnect has neither', async () => {
    const ac = makeStub(['Kaishi 1.5k', 'JlabNote', 'PrettyYomitan']);
    const cache = new Set<string>();

    await ensureAnkifyModels(ac, cache);

    expect(ac.createModel).toHaveBeenCalledTimes(2);
    const created = (ac.createModel as Mock).mock.calls.map(
      (args) => (args[0] as { modelName: string }).modelName
    );
    expect(created).toEqual(
      expect.arrayContaining([ANKIFY_BASIC_MODEL, ANKIFY_CLOZE_MODEL])
    );
    expect(cache.has(ANKIFY_BASIC_MODEL)).toBe(true);
    expect(cache.has(ANKIFY_CLOZE_MODEL)).toBe(true);
  });

  test('skips creation entirely when both models already exist', async () => {
    const ac = makeStub([ANKIFY_BASIC_MODEL, ANKIFY_CLOZE_MODEL, 'Other']);
    const cache = new Set<string>();

    await ensureAnkifyModels(ac, cache);

    expect(ac.createModel).not.toHaveBeenCalled();
    expect(cache.has(ANKIFY_BASIC_MODEL)).toBe(true);
    expect(cache.has(ANKIFY_CLOZE_MODEL)).toBe(true);
  });

  test('a second call with the same cache makes no AnkiConnect round-trip', async () => {
    const ac = makeStub([]);
    const cache = new Set<string>();

    await ensureAnkifyModels(ac, cache);
    (ac.modelNames as Mock).mockClear();
    (ac.createModel as Mock).mockClear();

    await ensureAnkifyModels(ac, cache);

    expect(ac.modelNames).not.toHaveBeenCalled();
    expect(ac.createModel).not.toHaveBeenCalled();
  });

  test('treats createModel "already exists" failure as success (race-safe)', async () => {
    const ac = makeStub([]);
    (ac.createModel as Mock).mockRejectedValueOnce(
      new Error('Model name already exists')
    );
    const cache = new Set<string>();

    await ensureAnkifyModels(ac, cache);

    expect(cache.has(ANKIFY_BASIC_MODEL)).toBe(true);
    expect(cache.has(ANKIFY_CLOZE_MODEL)).toBe(true);
  });

  test('creates the basic model from the user template when overrides are present', async () => {
    const ac = makeStub([]);
    const cache = new Set<string>();
    const customTemplate: TemplateFile = {
      parent: 'Basic',
      name: 'ATTI BASIC',
      storageKey: 'n2a-basic',
      front: '<div class="atti-front">{{Front}}</div>',
      back: '<div class="atti-back">{{Back}}</div>',
      styling: '.atti-front { color: tomato; }',
    };
    const overrides: AnkifyTemplateOverrides = {
      basicModelName: 'ATTI BASIC',
      basicTemplate: customTemplate,
    };

    await ensureAnkifyModels(ac, cache, overrides);

    const created = (ac.createModel as Mock).mock.calls.map(
      (args) =>
        args[0] as { modelName: string; inOrderFields: string[]; css: string }
    );
    const basic = created.find((c) => c.modelName === 'ATTI BASIC');
    expect(basic).toBeDefined();
    expect(basic?.inOrderFields).toEqual(['Front', 'Back', 'MyMedia']);
    expect(basic?.css).toContain('tomato');
    expect(cache.has('ATTI BASIC')).toBe(true);
    expect(created.some((c) => c.modelName === ANKIFY_BASIC_MODEL)).toBe(false);
  });
});
