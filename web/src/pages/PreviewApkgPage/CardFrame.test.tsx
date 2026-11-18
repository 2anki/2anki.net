import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApkgPreviewCard } from '../../lib/backend/getApkgPreview';
import { CardFrame } from './CardFrame';

const buildCard = (
  overrides: Partial<ApkgPreviewCard> = {}
): ApkgPreviewCard => ({
  id: 1,
  ord: 0,
  deckName: 'Sample Deck',
  deckPath: ['Sample Deck'],
  templateName: 'Basic',
  noteTypeName: 'Basic',
  front: 'Front content',
  back: 'Back content',
  css: 'body { color: #111; }',
  ...overrides,
});

const noop = () => {};

const getSrcDoc = (container: HTMLElement): string => {
  const iframe = container.querySelector('iframe');
  if (iframe == null) throw new Error('iframe not rendered');
  return iframe.getAttribute('srcdoc') ?? '';
};

const waitForSrcDoc = (container: HTMLElement): Promise<string> =>
  waitFor(() => {
    const srcDoc = getSrcDoc(container);
    if (!srcDoc) throw new Error('srcdoc not populated yet');
    return srcDoc;
  });

const findIframe = (container: HTMLElement): Promise<HTMLIFrameElement> =>
  waitFor(() => {
    const iframe = container.querySelector('iframe');
    if (iframe == null) throw new Error('iframe not rendered');
    return iframe as HTMLIFrameElement;
  });

describe('CardFrame sandbox', () => {
  it('sets sandbox to allow-scripts only', async () => {
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    expect((await findIframe(container)).getAttribute('sandbox')).toBe(
      'allow-scripts'
    );
  });
});

describe('CardFrame frame mounting', () => {
  // Chrome leaves a sandboxed frame blank when its srcdoc changes a few
  // milliseconds after it was inserted with an empty one.
  it('never mounts the frame with an empty document', async () => {
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    expect(container.querySelector('iframe')).toBeNull();
    const iframe = await findIframe(container);
    expect(iframe.getAttribute('srcdoc')).toContain('Front content');
  });

  it('mounts a new frame holding the back when the card is flipped', async () => {
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    const front = await findIframe(container);
    fireEvent.click(screen.getByRole('button', { name: /show back/i }));
    const back = await waitFor(() => {
      const iframe = container.querySelector('iframe');
      if (iframe == null || iframe === front) throw new Error('not remounted');
      return iframe;
    });
    expect(back.getAttribute('srcdoc')).toContain('Back content');
  });
});

describe('CardFrame srcDoc', () => {
  beforeEach(() => {
    localStorage.removeItem('2anki-theme');
  });

  it('does not inject hardcoded background or foreground colors', async () => {
    const card = buildCard({ css: '' });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).not.toContain('background: #fff');
    expect(srcDoc).not.toContain('color: #111');
  });

  it('drives color-scheme from the app theme (light by default)', async () => {
    localStorage.setItem('2anki-theme', 'light');
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('<meta name="color-scheme" content="light">');
    expect(srcDoc).not.toContain('class="nightMode"');
  });

  it('renders dark cards with nightMode + dark color-scheme when app theme is dark', async () => {
    localStorage.setItem('2anki-theme', 'dark');
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('<meta name="color-scheme" content="dark">');
    expect(srcDoc).toContain('<body class="nightMode">');
  });

  it('treats the light-background themes (gold) as light, not dark', async () => {
    localStorage.setItem('2anki-theme', 'gold');
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('<meta name="color-scheme" content="light">');
    expect(srcDoc).not.toContain('nightMode');
  });

  it('shims sessionStorage and localStorage so opaque-origin template scripts do not throw', async () => {
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain("['sessionStorage', 'localStorage'].forEach");
    expect(srcDoc).toContain('Object.defineProperty(window, name');
  });

  it('includes the resize-observer script', async () => {
    const { container } = render(
      <CardFrame card={buildCard()} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('ResizeObserver');
    expect(srcDoc).toContain('2anki-preview');
  });

  it('leaves benign markup intact', async () => {
    const card = buildCard({
      front: '<p class="q"><strong>Q:</strong> What is spaced repetition?</p>',
    });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('<p class="q">');
    expect(srcDoc).toContain('<strong>Q:</strong>');
  });

  it('includes card scripts in srcDoc', async () => {
    const card = buildCard({
      front: 'Hello<script>alert(1)</script> world',
    });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('alert(1)');
  });

  it('injects MathJax when the card contains inline math delimiters', async () => {
    const card = buildCard({ front: 'Euler: \\(e^{i\\pi} = -1\\)' });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).toContain('mathjax@3/es5/tex-mml-chtml.js');
    expect(srcDoc).toContain('window.MathJax');
  });

  it('injects MathJax when the back contains display math delimiters', async () => {
    const card = buildCard({
      front: 'Integral',
      back: '\\[\\int_0^1 x^2\\,dx\\]',
    });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: /show back/i }));
    const srcDoc = await waitFor(() => {
      const value = getSrcDoc(container);
      if (!value.includes('tex-mml-chtml.js')) {
        throw new Error('MathJax not injected yet');
      }
      return value;
    });
    expect(srcDoc).toContain('displayMath');
  });

  it('does not inject MathJax when the card has no math', async () => {
    const card = buildCard({ front: 'Plain front', back: 'Plain back' });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const srcDoc = await waitForSrcDoc(container);
    expect(srcDoc).not.toContain('tex-mml-chtml.js');
  });
});

describe('CardFrame postMessage height update', () => {
  it('updates frame height when a matching postMessage arrives', async () => {
    const card = buildCard({ id: 42 });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const iframe = await findIframe(container);

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      writable: true,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: '2anki-preview', cardId: '42', height: 480 },
          source: window,
          origin: 'null',
        })
      );
    });

    expect(iframe.style.height).toBe('480px');
  });

  it('ignores messages with wrong source string', async () => {
    const card = buildCard({ id: 7 });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const iframe = await findIframe(container);

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      writable: true,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'other', cardId: '7', height: 900 },
          source: window,
          origin: 'null',
        })
      );
    });

    expect(iframe.style.height).not.toBe('900px');
  });

  it('ignores messages with mismatched cardId', async () => {
    const card = buildCard({ id: 5 });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const iframe = await findIframe(container);

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      writable: true,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: '2anki-preview', cardId: '999', height: 700 },
          source: window,
          origin: 'null',
        })
      );
    });

    expect(iframe.style.height).not.toBe('700px');
  });

  it('ignores messages whose origin is not the sandboxed null origin', async () => {
    const card = buildCard({ id: 11 });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const iframe = await findIframe(container);

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      writable: true,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: '2anki-preview', cardId: '11', height: 600 },
          source: window,
          origin: 'https://evil.example',
        })
      );
    });

    expect(iframe.style.height).not.toBe('600px');
  });

  it('clamps height to MAX_FRAME_HEIGHT when value is too large', async () => {
    const card = buildCard({ id: 3 });
    const { container } = render(
      <CardFrame card={card} onEdit={noop} isEditable={false} />
    );
    const iframe = await findIframe(container);

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      writable: true,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: '2anki-preview', cardId: '3', height: 99999 },
          source: window,
          origin: 'null',
        })
      );
    });

    expect(iframe.style.height).toBe('2000px');
  });
});

const RAW_FRONT = 'Line one<br>Line&nbsp;two <img src="diagram.png">';

const editableCard = (overrides: Partial<ApkgPreviewCard> = {}) =>
  buildCard({
    id: 42,
    front:
      '<div>rendered front with /api/apkg/deck.apkg/media/diagram.png</div>',
    back: '<div>rendered front</div><hr id=answer>rendered back',
    editable: {
      front: { fieldIndex: 0, fieldName: 'Front', value: RAW_FRONT },
      back: { fieldIndex: 1, fieldName: 'Back', value: 'raw back' },
    },
    ...overrides,
  });

describe('CardFrame edit controls', () => {
  it('offers Edit, Delete and Show back, and no Suspend, when isEditable is true', () => {
    render(<CardFrame card={editableCard()} onEdit={noop} isEditable={true} />);
    expect(
      screen.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Delete', 'Show back', 'Edit front', 'Edit back']);
    expect(
      screen.queryByRole('button', { name: /suspend/i })
    ).not.toBeInTheDocument();
  });

  it('does not show Delete when isEditable is false', () => {
    render(
      <CardFrame card={editableCard()} onEdit={noop} isEditable={false} />
    );
    expect(
      screen.queryByRole('button', { name: /delete/i })
    ).not.toBeInTheDocument();
  });

  it('calls onEdit with the card id and deleted=true when Delete is clicked', () => {
    const onEdit = vi.fn();
    render(
      <CardFrame card={editableCard()} onEdit={onEdit} isEditable={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onEdit).toHaveBeenCalledWith(42, { deleted: true });
  });

  it('shows Restore button when card is marked deleted', () => {
    render(
      <CardFrame
        card={editableCard()}
        editState={{ deleted: true }}
        onEdit={noop}
        isEditable={true}
      />
    );
    expect(
      screen.getByRole('button', { name: /restore/i })
    ).toBeInTheDocument();
  });

  it('describes Delete as leaving the card out of the download, not out of Anki', () => {
    render(<CardFrame card={editableCard()} onEdit={noop} isEditable={true} />);
    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).toHaveAccessibleDescription(
      'Leave this card out of the download. A card already in your Anki collection stays there.'
    );
    expect(deleteButton).toHaveAttribute(
      'title',
      'Leave this card out of the download. A card already in your Anki collection stays there.'
    );
  });

  it('labels each editor with the field it changes', () => {
    render(
      <CardFrame
        card={editableCard({
          editable: {
            front: { fieldIndex: 1, fieldName: 'Back', value: 'b' },
            back: { fieldIndex: 0, fieldName: 'Front', value: 'f' },
          },
        })}
        onEdit={noop}
        isEditable={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit front/i }));
    expect(screen.getByRole('textbox', { name: 'Back' })).toHaveValue('b');
  });

  it('seeds the editor with the stored field, not the rendered card', () => {
    render(<CardFrame card={editableCard()} onEdit={noop} isEditable={true} />);
    fireEvent.click(screen.getByRole('button', { name: /edit front/i }));
    expect(screen.getByRole('textbox', { name: 'Front' })).toHaveValue(
      RAW_FRONT
    );
  });

  it('offers only the Text field on a cloze card', () => {
    render(
      <CardFrame
        card={editableCard({
          editable: {
            front: {
              fieldIndex: 0,
              fieldName: 'Text',
              value: '{{c1::Oslo}} is in Norway',
            },
            back: null,
          },
        })}
        onEdit={noop}
        isEditable={true}
      />
    );
    expect(
      screen.queryByRole('button', { name: /edit back/i })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit front/i }));
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue(
      '{{c1::Oslo}} is in Norway'
    );
  });

  it('offers no text editor on a card without an editable field', () => {
    render(
      <CardFrame
        card={buildCard({ editable: { front: null, back: null } })}
        onEdit={noop}
        isEditable={true}
      />
    );
    expect(
      screen.queryByRole('button', { name: /edit front/i })
    ).not.toBeInTheDocument();
  });

  it('records nothing when the editor closes without a change', () => {
    const onEdit = vi.fn();
    render(
      <CardFrame card={editableCard()} onEdit={onEdit} isEditable={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit back/i }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Back' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
  });

  it('pressing Escape cancels the edit without calling onEdit', () => {
    const onEdit = vi.fn();
    render(
      <CardFrame card={editableCard()} onEdit={onEdit} isEditable={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit front/i }));
    const textarea = screen.getByRole('textbox', { name: 'Front' });
    fireEvent.change(textarea, { target: { value: 'typed' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(
      screen.queryByRole('textbox', { name: 'Front' })
    ).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('pressing Enter records the draft under the field index', () => {
    const onEdit = vi.fn();
    render(
      <CardFrame card={editableCard()} onEdit={onEdit} isEditable={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit back/i }));
    const textarea = screen.getByRole('textbox', { name: 'Back' });
    fireEvent.change(textarea, { target: { value: 'new back' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith(42, { fields: { 1: 'new back' } });
  });

  it('drops the field edit when the draft goes back to the stored value', () => {
    const onEdit = vi.fn();
    render(
      <CardFrame
        card={editableCard()}
        editState={{ fields: { 1: 'new back' }, deleted: true }}
        onEdit={onEdit}
        isEditable={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit back/i }));
    const textarea = screen.getByRole('textbox', { name: 'Back' });
    expect(textarea).toHaveValue('new back');
    fireEvent.change(textarea, { target: { value: 'raw back' } });
    fireEvent.blur(textarea);
    expect(onEdit).toHaveBeenCalledWith(42, { fields: {}, deleted: true });
  });

  it('strips a pasted field separator from the draft before recording it', () => {
    const onEdit = vi.fn();
    render(
      <CardFrame card={editableCard()} onEdit={onEdit} isEditable={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit back/i }));
    const textarea = screen.getByRole('textbox', { name: 'Back' });
    fireEvent.change(textarea, {
      target: { value: `pasted${String.fromCharCode(0x1f)}text` },
    });
    expect(textarea).toHaveValue('pastedtext');
    fireEvent.blur(textarea);
    expect(onEdit).toHaveBeenCalledWith(42, { fields: { 1: 'pastedtext' } });
  });

  it('names the field on the closed editor’s button', () => {
    render(<CardFrame card={editableCard()} onEdit={noop} isEditable={true} />);
    expect(
      screen.getByRole('button', { name: /edit back/i })
    ).toHaveAccessibleDescription('Back');
  });

  it('keeps field names and edited text out of session recordings', () => {
    render(
      <CardFrame
        card={editableCard()}
        editState={{ fields: { 1: 'private answer' } }}
        onEdit={noop}
        isEditable={true}
      />
    );
    expect(screen.getByText('private answer')).toHaveAttribute(
      'data-hj-suppress'
    );
    expect(screen.getByText('Back')).toHaveAttribute('data-hj-suppress');
    fireEvent.click(screen.getByRole('button', { name: /edit front/i }));
    expect(screen.getByRole('textbox', { name: 'Front' })).toHaveAttribute(
      'data-hj-suppress'
    );
  });

  it('shows an edited field as text with an Edited marker', () => {
    render(
      <CardFrame
        card={editableCard()}
        editState={{ fields: { 1: '<b>bold</b> answer' } }}
        onEdit={noop}
        isEditable={true}
      />
    );
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByText('<b>bold</b> answer')).toBeInTheDocument();
  });
});
