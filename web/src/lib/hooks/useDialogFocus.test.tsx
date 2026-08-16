import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useDialogFocus } from './useDialogFocus';

function Harness({
  onClose,
  active = true,
}: Readonly<{ onClose: () => void; active?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose, active);
  return (
    <div ref={ref} role="dialog">
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </div>
  );
}

describe('useDialogFocus', () => {
  it('moves focus to the first focusable element on open', () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.getByText('first')).toHaveFocus();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wraps focus from the last element to the first on Tab', () => {
    render(<Harness onClose={vi.fn()} />);
    screen.getByText('last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByText('first')).toHaveFocus();
  });

  it('wraps focus from the first element to the last on Shift+Tab', () => {
    render(<Harness onClose={vi.fn()} />);
    screen.getByText('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('last')).toHaveFocus();
  });

  it('restores focus to the previously focused element on unmount', () => {
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(<Harness onClose={vi.fn()} />);
    expect(screen.getByText('first')).toHaveFocus();

    unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('does nothing while inactive', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} active={false} />);
    expect(screen.getByText('first')).not.toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
