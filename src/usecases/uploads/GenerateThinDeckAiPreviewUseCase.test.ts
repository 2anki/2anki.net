import { vi } from 'vitest';
import {
  generateThinDeckAiPreview,
  type ThinDeckAiPreviewDeps,
} from './GenerateThinDeckAiPreviewUseCase';

const CARDS = [{ front: 'What is ATP?', back: 'The cell energy currency.' }];

function makeDeps(
  overrides: Partial<ThinDeckAiPreviewDeps> = {}
): ThinDeckAiPreviewDeps {
  return {
    isEnabled: vi.fn().mockResolvedValue(true),
    allow: vi.fn().mockReturnValue(true),
    preview: vi.fn().mockResolvedValue(CARDS),
    onShown: vi.fn(),
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    visitorKey: 'anon:abc',
    ipKey: 'ip-1',
    filename: 'lecture.pdf',
    bytes: Buffer.from('text'),
    ...overrides,
  };
}

describe('generateThinDeckAiPreview', () => {
  it('returns the sample cards and reports how many were shown', async () => {
    const deps = makeDeps();

    const outcome = await generateThinDeckAiPreview(input(), deps);

    expect(outcome).toEqual({ kind: 'preview', cards: CARDS });
    expect(deps.onShown).toHaveBeenCalledWith('anon:abc', 1);
  });

  it('does nothing when the flag is off', async () => {
    const deps = makeDeps({ isEnabled: vi.fn().mockResolvedValue(false) });

    const outcome = await generateThinDeckAiPreview(input(), deps);

    expect(outcome).toEqual({ kind: 'disabled' });
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it('does not call Claude for a file type it cannot read', async () => {
    const deps = makeDeps();

    const outcome = await generateThinDeckAiPreview(
      input({ filename: 'slides.pptx' }),
      deps
    );

    expect(outcome).toEqual({ kind: 'unsupported' });
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it('does not call Claude once a rate limit is hit', async () => {
    const deps = makeDeps({ allow: vi.fn().mockReturnValue(false) });

    const outcome = await generateThinDeckAiPreview(input(), deps);

    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it.each(['plan:42', 'preview:abc'])(
    'refuses a visitor key in the reserved %s namespace',
    async (visitorKey) => {
      const deps = makeDeps();

      const outcome = await generateThinDeckAiPreview(
        input({ visitorKey }),
        deps
      );

      expect(outcome).toEqual({ kind: 'unavailable' });
      expect(deps.preview).not.toHaveBeenCalled();
    }
  );

  it('answers unavailable when the model call fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({
      preview: vi.fn().mockRejectedValue(new Error('overloaded')),
    });

    const outcome = await generateThinDeckAiPreview(input(), deps);

    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(deps.onShown).not.toHaveBeenCalled();
  });

  it('answers unavailable when no cards come back', async () => {
    const deps = makeDeps({ preview: vi.fn().mockResolvedValue([]) });

    const outcome = await generateThinDeckAiPreview(input(), deps);

    expect(outcome).toEqual({ kind: 'unavailable' });
    expect(deps.onShown).not.toHaveBeenCalled();
  });
});
