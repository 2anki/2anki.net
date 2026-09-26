import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotionColumnMappingModal } from './NotionColumnMappingModal';

const COLUMNS = ['Question', 'Answer', 'Tags', 'Source'];
const SUGGESTED = { frontField: 'Question', backField: 'Answer' };

function renderModal(
  props?: Partial<React.ComponentProps<typeof NotionColumnMappingModal>>
) {
  const defaults = {
    isOpen: true,
    columns: COLUMNS,
    suggested: SUGGESTED,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };
  return render(<NotionColumnMappingModal {...defaults} {...props} />);
}

function fakeShowModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
}

function fakeClose(this: HTMLDialogElement) {
  this.removeAttribute('open');
}

describe('NotionColumnMappingModal', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(fakeShowModal);
    HTMLDialogElement.prototype.close = vi.fn(fakeClose);
  });

  it('renders the heading', () => {
    renderModal();
    expect(screen.getByText('Map your columns')).toBeTruthy();
  });

  it('shows front and back selects populated with columns', () => {
    renderModal();
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    const options = selects[0].querySelectorAll('option');
    expect(options.length).toBe(COLUMNS.length);
  });

  it('pre-selects suggested values', () => {
    renderModal();
    const [frontSelect, backSelect] = screen.getAllByRole('combobox');
    expect((frontSelect as HTMLSelectElement).value).toBe('Question');
    expect((backSelect as HTMLSelectElement).value).toBe('Answer');
  });

  it('calls onSubmit with selected mapping when primary button clicked', () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    fireEvent.click(screen.getByText('Convert with this mapping'));
    expect(onSubmit).toHaveBeenCalledWith({
      frontField: 'Question',
      backField: 'Answer',
    });
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit when front and back select the same column', () => {
    renderModal();
    const [frontSelect] = screen.getAllByRole('combobox');
    fireEvent.change(frontSelect, { target: { value: 'Answer' } });
    const submitBtn = screen.getByText('Convert with this mapping');
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows error message when same column selected for both fields', () => {
    renderModal();
    const [frontSelect] = screen.getAllByRole('combobox');
    fireEvent.change(frontSelect, { target: { value: 'Answer' } });
    expect(
      screen.getByText('Front and back must be different columns.')
    ).toBeTruthy();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText('Map your columns')).toBeNull();
  });
});

describe('parseAmbiguousColumnsPayload', () => {
  it('returns null for null input', async () => {
    const { parseAmbiguousColumnsPayload } =
      await import('../../lib/fieldMapping/types');
    expect(parseAmbiguousColumnsPayload(null)).toBeNull();
  });

  it('returns null for non-prefixed string', async () => {
    const { parseAmbiguousColumnsPayload } =
      await import('../../lib/fieldMapping/types');
    expect(parseAmbiguousColumnsPayload('generic error')).toBeNull();
  });

  it('parses valid COLUMNS_AMBIGUOUS payload', async () => {
    const { parseAmbiguousColumnsPayload, COLUMNS_AMBIGUOUS_PREFIX } =
      await import('../../lib/fieldMapping/types');
    const payload = {
      columns: ['Q', 'A', 'Tags'],
      suggested: { frontField: 'Q', backField: 'A' },
    };
    const input = `${COLUMNS_AMBIGUOUS_PREFIX}${JSON.stringify(payload)}`;
    expect(parseAmbiguousColumnsPayload(input)).toEqual(payload);
  });

  it('returns null for malformed JSON after prefix', async () => {
    const { parseAmbiguousColumnsPayload, COLUMNS_AMBIGUOUS_PREFIX } =
      await import('../../lib/fieldMapping/types');
    expect(
      parseAmbiguousColumnsPayload(`${COLUMNS_AMBIGUOUS_PREFIX}not-json`)
    ).toBeNull();
  });
});
