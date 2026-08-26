import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DragEvent } from 'react';
import { useDropZone } from './useDropZone';

function Harness({
  onDrop,
}: Readonly<{ onDrop: (event: DragEvent<HTMLElement>) => void }>) {
  const { dropHover, dragProps } = useDropZone({ onDrop });
  return (
    <div>
      <div data-testid="zone" {...dragProps}>
        {dropHover ? 'hovering' : 'idle'}
      </div>
      <div data-testid="outside">outside</div>
    </div>
  );
}

describe('useDropZone', () => {
  it('tracks hover on the element and hands the drop over', () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const zone = screen.getByTestId('zone');

    fireEvent.dragEnter(zone);
    expect(zone).toHaveTextContent('hovering');

    fireEvent.drop(zone);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(zone).toHaveTextContent('idle');
  });

  it('binds to the element, not the page', () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const zone = screen.getByTestId('zone');

    fireEvent.dragEnter(zone);
    expect(zone).toHaveTextContent('hovering');

    fireEvent.drop(screen.getByTestId('outside'));
    fireEvent.drop(document.body);

    expect(onDrop).not.toHaveBeenCalled();
    expect(zone).toHaveTextContent('hovering');
  });
});
