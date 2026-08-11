import { isChatCardTemplate, templatePromptSuffix } from './chatTemplates';

describe('isChatCardTemplate', () => {
  it.each(['basic', 'basic-and-reversed', 'cloze', 'mcq'] as const)(
    'returns true for valid slug "%s"',
    (slug) => {
      expect(isChatCardTemplate(slug)).toBe(true);
    }
  );

  it.each([null, undefined, '', 'image-occlusion', 123])(
    'returns false for invalid value %s',
    (value) => {
      expect(isChatCardTemplate(value)).toBe(false);
    }
  );
});

describe('templatePromptSuffix', () => {
  it('describes basic front/back as a default that yields to explicit requests', () => {
    const suffix = templatePromptSuffix('basic');
    expect(suffix.length).toBeGreaterThan(0);
    expect(suffix).toMatch(/front/i);
    expect(suffix).toMatch(/back/i);
    expect(suffix).toMatch(/unless the user explicitly asks/i);
    expect(suffix).toMatch(/Format: cloze/);
    expect(suffix).not.toMatch(/TEMPLATE OVERRIDE/);
  });

  it('returns a suffix for basic-and-reversed that yields to explicit requests', () => {
    const suffix = templatePromptSuffix('basic-and-reversed');
    expect(suffix.length).toBeGreaterThan(0);
    expect(suffix).toMatch(/both directions/i);
    expect(suffix).toMatch(/unless the user explicitly asks/i);
  });

  it('returns a cloze-specific suffix that yields to explicit requests', () => {
    const suffix = templatePromptSuffix('cloze');
    expect(suffix).toMatch(/cloze/i);
    expect(suffix).toMatch(/\{\{c1::/);
    expect(suffix).toMatch(/unless the user explicitly asks/i);
    expect(suffix).not.toMatch(/TEMPLATE OVERRIDE/);
  });

  it('returns an mcq-specific suffix for mcq template', () => {
    const suffix = templatePromptSuffix('mcq');
    expect(suffix).toMatch(/multiple.choice/i);
    expect(suffix).toMatch(/correct_index/);
    expect(suffix).toMatch(/four options/);
  });
});
