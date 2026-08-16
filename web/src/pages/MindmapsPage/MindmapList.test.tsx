import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNavigate, mockDelete, mockUseMindmapList } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockDelete: vi.fn(),
  mockUseMindmapList: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('./useMindmap', () => ({
  useMindmapList: () => mockUseMindmapList(),
  useCreateMindmap: () => ({ mutateAsync: vi.fn() }),
  useDeleteMindmap: () => ({ mutate: mockDelete }),
}));

import { MindmapList } from './MindmapList';

const access = {
  hasUnlimited: true,
  currentCount: 1,
  freeMapLimit: 3,
  maxNodesPerMap: 50,
};

describe('MindmapList', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockDelete.mockClear();
    mockUseMindmapList.mockReturnValue({
      data: { maps: [{ id: 'm1', title: 'Cardiology' }], access },
      isLoading: false,
    });
  });

  it('renders the open and delete controls as separate, non-nested buttons', () => {
    render(<MindmapList />);
    const openBtn = screen.getByRole('button', { name: 'Cardiology' });
    const deleteBtn = screen.getByRole('button', { name: 'Delete Cardiology' });
    expect(deleteBtn.tagName).toBe('BUTTON');
    expect(openBtn).not.toContainElement(deleteBtn);
  });

  it('opens the map when the open button is clicked', () => {
    render(<MindmapList />);
    fireEvent.click(screen.getByRole('button', { name: 'Cardiology' }));
    expect(mockNavigate).toHaveBeenCalledWith('/mindmaps/m1');
  });

  it('deletes the map without navigating when the delete button is activated', () => {
    render(<MindmapList />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Cardiology' }));
    expect(mockDelete).toHaveBeenCalledWith('m1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
