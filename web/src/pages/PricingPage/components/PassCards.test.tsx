import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PassCards } from './PassCards';

type Overrides = Partial<Parameters<typeof PassCards>[0]>;

function renderPassCards(overrides: Overrides = {}) {
  const props = {
    onDayPass: vi.fn(),
    onWeekPass: vi.fn(),
    onSemesterPass: vi.fn(),
    dayPassPending: false,
    weekPassPending: false,
    semesterPassPending: false,
    ...overrides,
  };
  return { props, ...render(<PassCards {...props} />) };
}

describe('PassCards', () => {
  it('renders Day, Week, and Semester Pass cards side by side', () => {
    renderPassCards();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Semester Pass' })
    ).toBeInTheDocument();
  });

  it('omits the Semester Pass card when onSemesterPass is not provided', () => {
    renderPassCards({ onSemesterPass: undefined });
    expect(
      screen.queryByRole('button', { name: 'Get Semester Pass' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('No subscription').length).toBe(2);
  });

  it('does not hide the pass cards behind an accordion', () => {
    const { container } = renderPassCards();
    expect(container.querySelector('details')).toBeNull();
  });

  it('shows the No subscription benefit on each of the three cards', () => {
    renderPassCards();
    expect(screen.getAllByText('No subscription').length).toBe(3);
  });

  it('does not list No ads — the whole product is ad-free', () => {
    renderPassCards();
    expect(screen.queryByText('No ads')).not.toBeInTheDocument();
  });

  it('calls onDayPass when Get Day Pass is clicked', () => {
    const onDayPass = vi.fn();
    renderPassCards({ onDayPass });
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass' }));
    expect(onDayPass).toHaveBeenCalledOnce();
  });

  it('calls onWeekPass when Get Week Pass is clicked', () => {
    const onWeekPass = vi.fn();
    renderPassCards({ onWeekPass });
    fireEvent.click(screen.getByRole('button', { name: 'Get Week Pass' }));
    expect(onWeekPass).toHaveBeenCalledOnce();
  });

  it('calls onSemesterPass when Get Semester Pass is clicked', () => {
    const onSemesterPass = vi.fn();
    renderPassCards({ onSemesterPass });
    fireEvent.click(screen.getByRole('button', { name: 'Get Semester Pass' }));
    expect(onSemesterPass).toHaveBeenCalledOnce();
  });

  it('disables the Day Pass button when dayPassPending', () => {
    renderPassCards({ dayPassPending: true });
    expect(
      screen.getAllByRole('button', { name: 'Redirecting…' })[0]
    ).toBeDisabled();
  });

  it('disables the Semester Pass button when semesterPassPending', () => {
    renderPassCards({ semesterPassPending: true });
    expect(screen.getByRole('button', { name: 'Redirecting…' })).toBeDisabled();
  });

  it('renders correct pricing for each pass', () => {
    renderPassCards();
    expect(screen.getByText('$4')).toBeInTheDocument();
    expect(screen.getByText('$9')).toBeInTheDocument();
    expect(screen.getByText('$29')).toBeInTheDocument();
  });

  it('features the Day Pass as Most popular without overclaiming', () => {
    renderPassCards({ featureDayPass: true });
    expect(screen.getByText('Most popular')).toBeInTheDocument();
    expect(screen.queryByText('Best value')).not.toBeInTheDocument();
  });
});
