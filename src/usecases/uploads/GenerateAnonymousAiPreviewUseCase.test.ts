import { describe, it, expect, vi } from 'vitest';
import {
  generateAnonymousAiPreview,
  type AnonymousAiPreviewDeps,
} from './GenerateAnonymousAiPreviewUseCase';

const CARDS = [{ front: 'q', back: 'a' }];

function deps(
  overrides: Partial<AnonymousAiPreviewDeps> = {}
): AnonymousAiPreviewDeps {
  return {
    isEnabled: vi.fn().mockResolvedValue(true),
    allow: vi.fn().mockReturnValue(true),
    preview: vi.fn().mockResolvedValue(CARDS),
    storeSource: vi.fn().mockResolvedValue(undefined),
    onShown: vi.fn(),
    ...overrides,
  };
}

const input = {
  anonId: 'visitor-1',
  ipKey: 'ip-1',
  filename: 'notes.pdf',
  bytes: Buffer.from('%PDF data'),
  requestId: 'r1',
};

describe('generateAnonymousAiPreview', () => {
  it('returns today’s behaviour (null) and runs no AI when the flag is off', async () => {
    const d = deps({ isEnabled: vi.fn().mockResolvedValue(false) });
    const result = await generateAnonymousAiPreview(input, d);
    expect(result).toBeNull();
    expect(d.preview).not.toHaveBeenCalled();
    expect(d.storeSource).not.toHaveBeenCalled();
    expect(d.onShown).not.toHaveBeenCalled();
  });

  it('returns null without a visitor id (nothing to key the resume on)', async () => {
    const d = deps();
    const result = await generateAnonymousAiPreview(
      { ...input, anonId: null },
      d
    );
    expect(result).toBeNull();
    expect(d.preview).not.toHaveBeenCalled();
  });

  it('runs no preview for an unsupported file type', async () => {
    const d = deps();
    const result = await generateAnonymousAiPreview(
      { ...input, filename: 'slides.pptx' },
      d
    );
    expect(result).toBeNull();
    expect(d.preview).not.toHaveBeenCalled();
  });

  it('runs no preview when the visitor or IP is over the daily limit', async () => {
    const d = deps({ allow: vi.fn().mockReturnValue(false) });
    const result = await generateAnonymousAiPreview(input, d);
    expect(result).toBeNull();
    expect(d.preview).not.toHaveBeenCalled();
    expect(d.storeSource).not.toHaveBeenCalled();
  });

  it('shows the cards, stores the source, and fires the shown event on success', async () => {
    const d = deps();
    const result = await generateAnonymousAiPreview(input, d);
    expect(result).toEqual(CARDS);
    expect(d.preview).toHaveBeenCalledWith('notes.pdf', input.bytes, 'r1');
    expect(d.storeSource).toHaveBeenCalledWith(
      'visitor-1',
      'notes.pdf',
      input.bytes
    );
    expect(d.onShown).toHaveBeenCalledWith('visitor-1', 1);
  });

  it('falls through to null when the preview produced no cards', async () => {
    const d = deps({ preview: vi.fn().mockResolvedValue([]) });
    const result = await generateAnonymousAiPreview(input, d);
    expect(result).toBeNull();
    expect(d.storeSource).not.toHaveBeenCalled();
    expect(d.onShown).not.toHaveBeenCalled();
  });

  it('falls through to null when preview generation throws', async () => {
    const d = deps({
      preview: vi.fn().mockRejectedValue(new Error('claude down')),
    });
    const result = await generateAnonymousAiPreview(input, d);
    expect(result).toBeNull();
    expect(d.onShown).not.toHaveBeenCalled();
  });

  it('still shows the preview if storing the source for resume fails', async () => {
    const d = deps({
      storeSource: vi.fn().mockRejectedValue(new Error('storage down')),
    });
    const result = await generateAnonymousAiPreview(input, d);
    expect(result).toEqual(CARDS);
    expect(d.onShown).toHaveBeenCalledWith('visitor-1', 1);
  });
});
