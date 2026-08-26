import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindmapNode } from './MindmapNode';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  NodeResizer: () => null,
  NodeToolbar: ({
    children,
    isVisible,
  }: {
    children: React.ReactNode;
    isVisible?: boolean;
  }) => (isVisible ? children : null),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

function makeProps(
  overrides: Partial<{
    label: string;
    editing: boolean;
    onCommit: (label: string) => void;
    onCancel: () => void;
    onReplaceImage: (file: File) => void;
    image: {
      url: string | null;
      width: number;
      height: number;
      missing?: true;
    };
  }> = {}
) {
  const { image, ...rest } = overrides;
  return {
    data: {
      label: 'Test node',
      editing: false,
      onCommit: vi.fn(),
      onCancel: vi.fn(),
      ...(image == null ? {} : { image }),
      ...rest,
    },
    id: 'node-1',
    type: 'mindmap',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    draggable: true,
    selectable: true,
    deletable: true,
  } as Parameters<typeof MindmapNode>[0];
}

describe('MindmapNode', () => {
  it('renders label as text when not editing', () => {
    render(<MindmapNode {...makeProps({ label: 'Biology' })} />);
    expect(screen.getByText('Biology')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders input when editing is true', () => {
    render(<MindmapNode {...makeProps({ editing: true })} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe('Test node');
  });

  it('calls onCommit with trimmed value on plain Enter', () => {
    const onCommit = vi.fn();
    render(<MindmapNode {...makeProps({ editing: true, onCommit })} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  Chemistry  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Chemistry');
  });

  it('still commits on Ctrl+Enter', () => {
    const onCommit = vi.fn();
    render(<MindmapNode {...makeProps({ editing: true, onCommit })} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Chemistry' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith('Chemistry');
  });

  it('does not commit on Shift+Enter so the textarea gets a newline', () => {
    const onCommit = vi.fn();
    render(<MindmapNode {...makeProps({ editing: true, onCommit })} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not commit on Enter while an IME composition is in progress', () => {
    const onCommit = vi.fn();
    render(<MindmapNode {...makeProps({ editing: true, onCommit })} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '化学' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn();
    render(<MindmapNode {...makeProps({ editing: true, onCancel })} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCommit with original label when Enter pressed with empty input', () => {
    const onCommit = vi.fn();
    render(
      <MindmapNode
        {...makeProps({ label: 'Physics', editing: true, onCommit })}
      />
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Physics');
  });

  it('calls onCommit on blur', () => {
    const onCommit = vi.fn();
    render(
      <MindmapNode {...makeProps({ editing: true, label: 'Math', onCommit })} />
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Mathematics' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('Mathematics');
  });

  it('renders image when url is present', () => {
    const props = makeProps({ label: 'alt text' });
    (props.data as Record<string, unknown>).image = {
      url: 'https://example.com/img.png',
      width: 10,
      height: 10,
    };
    const { container } = render(<MindmapNode {...props} />);
    const img = container.querySelector('img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://example.com/img.png');
  });

  it('renders placeholder when image is missing', () => {
    const props = makeProps({ label: '' });
    (props.data as Record<string, unknown>).image = {
      url: null,
      width: 10,
      height: 10,
      missing: true,
    };
    render(<MindmapNode {...props} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Image unavailable')).toBeDefined();
  });

  it('does not show Replace image button when node has no image', () => {
    const props = makeProps({ label: 'no image node' });
    props.selected = true;
    render(<MindmapNode {...props} />);
    expect(screen.queryByTitle('Replace image')).toBeNull();
  });

  it('shows Replace image button in toolbar when node has an image and is selected', () => {
    const onReplaceImage = vi.fn();
    const props = makeProps({
      image: { url: 'https://example.com/img.png', width: 100, height: 80 },
      onReplaceImage,
    });
    props.selected = true;
    render(<MindmapNode {...props} />);
    expect(screen.getByTitle('Replace image')).toBeDefined();
  });

  it('calls onReplaceImage with selected file when Replace image button activates file input', () => {
    const onReplaceImage = vi.fn();
    const props = makeProps({
      image: { url: 'https://example.com/img.png', width: 100, height: 80 },
      onReplaceImage,
    });
    props.selected = true;
    const { container } = render(<MindmapNode {...props} />);

    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput!);

    expect(onReplaceImage).toHaveBeenCalledWith(file);
  });

  it('stops key propagation while editing', () => {
    const handler = vi.fn();
    render(
      <div onKeyDown={handler}>
        <MindmapNode {...makeProps({ editing: true })} />
      </div>
    );
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(handler).not.toHaveBeenCalled();
  });
});
