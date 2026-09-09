import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, test, vi } from 'vitest';

import { OpsWindowControl } from './OpsHeaderControls';

describe('OpsWindowControl', () => {
  test('labels each segment with its span and presses the active one', () => {
    render(<OpsWindowControl window="90d" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(
      screen.getByRole('button', { name: 'Last 90 days' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Last 90 days' })
    ).toHaveTextContent('90d');
  });

  test('reports the chosen window', () => {
    const onChange = vi.fn();
    render(<OpsWindowControl window="30d" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(onChange).toHaveBeenCalledWith('7d');
  });
});
