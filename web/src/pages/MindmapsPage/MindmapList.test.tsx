import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNavigate, mockDelete, mockUseMindmapList, mockCreate, mockTrack } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockDelete: vi.fn(),
    mockUseMindmapList: vi.fn(),
    mockCreate: vi.fn(),
    mockTrack: vi.fn(),
  }));

vi.mock('../../lib/analytics/track', () => ({ track: mockTrack }));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('./useMindmap', () => ({
  useMindmapList: () => mockUseMindmapList(),
  useCreateMindmap: () => ({ mutateAsync: mockCreate }),
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
    mockCreate.mockReset();
    mockTrack.mockClear();
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

  it('records mindmap_created once a new map exists', async () => {
    mockCreate.mockResolvedValue({ id: 'm2' });
    render(<MindmapList />);
    fireEvent.click(screen.getByRole('button', { name: 'New map' }));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/mindmaps/m2')
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('mindmap_created');
  });

  it('does not record mindmap_created when the free map limit blocks the click', () => {
    mockUseMindmapList.mockReturnValue({
      data: {
        maps: [],
        access: { ...access, hasUnlimited: false, currentCount: 3 },
      },
      isLoading: false,
    });
    render(
      <MemoryRouter>
        <MindmapList />
      </MemoryRouter>
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'New map' })[0]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
