import { vi } from 'vitest';
import {
  AnkifyTemplateOverrides,
  buildBasicModelFromTemplate,
  makeAnkifyTemplateOverridesProvider,
} from './templateOverrides';

const sampleOverrides = (): AnkifyTemplateOverrides => ({
  basicModelName: 'CUSTOM BASIC',
  basicTemplate: {
    parent: 'Basic',
    name: 'CUSTOM BASIC',
    storageKey: 'n2a-basic',
    front: '{{Front}}',
    back: '{{Back}}',
    styling: '.card { color: teal; }',
  },
});

describe('makeAnkifyTemplateOverridesProvider', () => {
  it('forwards the owner as a string with both page id candidates', async () => {
    const loadAnkifyTemplateOverrides = vi
      .fn()
      .mockResolvedValue(sampleOverrides());

    const provider = makeAnkifyTemplateOverridesProvider({
      loadAnkifyTemplateOverrides,
    });
    const result = await provider(13574, 'child-page', 'database-id');

    expect(loadAnkifyTemplateOverrides).toHaveBeenCalledWith(
      '13574',
      'child-page',
      'database-id'
    );
    expect(result?.basicModelName).toBe('CUSTOM BASIC');
  });

  it('forwards a call without page ids unchanged', async () => {
    const loadAnkifyTemplateOverrides = vi.fn().mockResolvedValue(null);

    const provider = makeAnkifyTemplateOverridesProvider({
      loadAnkifyTemplateOverrides,
    });
    const result = await provider(42);

    expect(loadAnkifyTemplateOverrides).toHaveBeenCalledWith(
      '42',
      undefined,
      undefined
    );
    expect(result).toBeNull();
  });
});

describe('buildBasicModelFromTemplate', () => {
  it('builds the model from the template fields and styling', () => {
    const overrides = sampleOverrides();

    const model = buildBasicModelFromTemplate(
      overrides.basicTemplate,
      overrides.basicModelName
    );

    expect(model).toMatchObject({
      modelName: 'CUSTOM BASIC',
      css: '.card { color: teal; }',
      isCloze: false,
      inOrderFields: ['Front', 'Back', 'MyMedia'],
    });
    expect(model.cardTemplates).toEqual([
      { Name: 'Card 1', Front: '{{Front}}', Back: '{{Back}}' },
    ]);
  });
});
