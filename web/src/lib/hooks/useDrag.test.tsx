import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { useDrag } from './useDrag';

function Harness({
  onDrop,
  label = 'zone',
}: Readonly<{ onDrop: (event: DragEvent) => void; label?: string }>) {
  const { dropHover } = useDrag({ onDrop });
  return <div data-testid={label}>{dropHover ? 'hovering' : 'idle'}</div>;
}

describe('useDrag', () => {
  it('tracks hover from body drag events', () => {
    const { getByTestId } = render(<Harness onDrop={vi.fn()} />);

    fireEvent.dragEnter(document.body);
    expect(getByTestId('zone')).toHaveTextContent('hovering');

    fireEvent.dragLeave(document.body);
    expect(getByTestId('zone')).toHaveTextContent('idle');
  });

  it('hands a body drop to the latest onDrop after a rerender', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onDrop={first} />);

    rerender(<Harness onDrop={second} />);
    fireEvent.drop(document.body);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the consumer unmounts', () => {
    const onDrop = vi.fn();
    const { unmount } = render(<Harness onDrop={onDrop} />);

    unmount();
    fireEvent.drop(document.body);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('lets two mounted consumers both receive the drop', () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <>
        <Harness onDrop={a} label="a" />
        <Harness onDrop={b} label="b" />
      </>
    );

    fireEvent.drop(document.body);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
