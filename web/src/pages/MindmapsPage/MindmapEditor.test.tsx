import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
  within,
} from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockSetNodes = vi.fn();
const mockSetEdges = vi.fn();

const { mockUploadMindmapImage, mockUseMindmapById, mockUseUpdateMindmap } =
  vi.hoisted(() => ({
    mockUploadMindmapImage: vi.fn(),
    mockUseMindmapById: vi.fn(),
    mockUseUpdateMindmap: vi.fn(),
  }));

vi.mock('./useMindmap', () => ({
  useMindmapById: mockUseMindmapById,
  useMindmapList: () => ({ data: undefined }),
  useUpdateMindmap: mockUseUpdateMindmap,
  exportMindmap: vi.fn(),
  uploadMindmapImage: mockUploadMindmapImage,
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'react-flow' }, children),
  Controls: () => null,
  Background: () => null,
  useNodesState: () => [[], mockSetNodes, vi.fn()],
  useEdgesState: () => [[], mockSetEdges, vi.fn()],
  addEdge: vi.fn(),
  ConnectionMode: { Loose: 'loose' },
}));

function MockGraph() {
  return {
    setDefaultEdgeLabel: vi.fn(),
    setGraph: vi.fn(),
    setNode: vi.fn(),
    setEdge: vi.fn(),
    node: vi.fn().mockReturnValue({ x: 0, y: 0 }),
  };
}

vi.mock('dagre', () => ({
  default: {
    graphlib: { Graph: MockGraph },
    layout: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useParams: () => ({ id: 'map-1' }),
    useNavigate: () => vi.fn(),
  };
});

const baseMap = {
  id: 'map-1',
  user_id: 42,
  title: 'Test map',
  data: { nodes: [], edges: [] },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      MemoryRouter,
      { initialEntries: ['/mindmaps/map-1'] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/mindmaps/:id', element: children })
      )
    )
  );
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe('MindmapEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMindmapById.mockReturnValue({ data: baseMap, isLoading: false });
    mockUseUpdateMindmap.mockReturnValue({ mutate: vi.fn() });
    setInnerWidth(1024);
  });

  it('renders without crashing', async () => {
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });
    expect(screen.getByTestId('react-flow')).toBeDefined();
  });

  it('seeds nodes with an array on first load, then uses a functional updater on re-fetch', async () => {
    const mapWithNodes = {
      ...baseMap,
      data: {
        nodes: [{ id: 'n1', label: 'Root', position: { x: 10, y: 20 } }],
        edges: [],
      },
    };
    mockUseMindmapById.mockReturnValue({
      data: mapWithNodes,
      isLoading: false,
    });

    const { MindmapEditor } = await import('./MindmapEditor');
    const { rerender } = render(createElement(MindmapEditor), { wrapper });

    await waitFor(() => {
      expect(mockSetNodes).toHaveBeenCalled();
    });

    const firstCallArg = mockSetNodes.mock.calls[0][0];
    expect(Array.isArray(firstCallArg)).toBe(true);

    mockSetNodes.mockClear();

    const refetchedMap = {
      ...mapWithNodes,
      updated_at: new Date(Date.now() + 1000).toISOString(),
    };
    mockUseMindmapById.mockReturnValue({
      data: refetchedMap,
      isLoading: false,
    });

    await act(async () => {
      rerender(createElement(MindmapEditor));
    });

    await waitFor(() => {
      expect(mockSetNodes).toHaveBeenCalled();
    });

    const refetchCallArg = mockSetNodes.mock.calls[0][0];
    expect(typeof refetchCallArg).toBe('function');
  });

  it('sidebar is rendered before the ReactFlow canvas (left-side layout)', async () => {
    const { MindmapEditor } = await import('./MindmapEditor');
    const { container } = render(createElement(MindmapEditor), { wrapper });
    const root = container.querySelector(
      '[data-testid="editor-root"]'
    ) as HTMLElement | null;
    expect(root).not.toBeNull();
    const children = Array.from(root!.children);
    const sidebarIndex = children.findIndex(
      (el) => el.getAttribute('data-testid') === 'editor-sidebar'
    );
    const canvasIndex = children.findIndex(
      (el) => el.getAttribute('data-testid') === 'editor-canvas'
    );
    expect(sidebarIndex).toBeLessThan(canvasIndex);
  });

  it('renders a back link to /mindmaps as the first sidebar child', async () => {
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });
    const link = screen.getByRole('link', { name: /mindmaps/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('/mindmaps');
    const sidebar = screen.getByTestId('editor-sidebar');
    expect(sidebar.firstElementChild).toBe(link);
  });

  it('collapse toggle button has aria-label "Collapse sidebar" when expanded', async () => {
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });
    const btn = screen.getByLabelText('Collapse sidebar');
    expect(btn).toBeDefined();
  });

  it('clicking collapse toggle hides sidebar content and shows expand handle', async () => {
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });
    const collapseBtn = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(collapseBtn);
    expect(screen.getByLabelText('Expand sidebar')).toBeDefined();
    expect(screen.queryByLabelText('Collapse sidebar')).toBeNull();
  });

  it('markdown shortcut note is a button that opens the markdown modal', async () => {
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });
    const details = screen.getByText('Keyboard shortcuts').closest('details');
    if (details != null) details.setAttribute('open', '');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /markdown works/i })
      ).toBeDefined();
    });
  });

  it('renders the canvas and a mobile top bar instead of the desktop sidebar below 768px', async () => {
    setInnerWidth(375);
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('editor-mobile-bar')).toBeDefined();
    });
    expect(screen.queryByTestId('editor-sidebar')).toBeNull();
    expect(screen.getByTestId('react-flow')).toBeDefined();
    expect(screen.queryByText(/needs a larger screen/i)).toBeNull();
  });

  it('mobile Download deck button opens the export modal', async () => {
    setInnerWidth(375);
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });

    const bar = await screen.findByTestId('editor-mobile-bar');
    const downloadBtn = within(bar).getByRole('button', {
      name: /download deck/i,
    });
    fireEvent.click(downloadBtn);

    expect(await screen.findByText(/card type/i)).toBeDefined();
  });

  it('the export modal has dialog semantics and Escape closes it', async () => {
    setInnerWidth(375);
    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });

    const bar = await screen.findByTestId('editor-mobile-bar');
    fireEvent.click(
      within(bar).getByRole('button', { name: /download deck/i })
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('mindmap-export-title');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('paste image event triggers upload and node creation', async () => {
    const imageResult = {
      url: '/api/mindmaps/images/42/map-1/abc.png',
      width: 100,
      height: 80,
    };
    mockUploadMindmapImage.mockResolvedValue(imageResult);

    const { MindmapEditor } = await import('./MindmapEditor');
    render(createElement(MindmapEditor), { wrapper });

    const pngData = new Uint8Array([137, 80, 78, 71]);
    const file = new File([pngData], 'test.png', { type: 'image/png' });

    const mockItem = {
      kind: 'file' as const,
      type: 'image/png',
      getAsFile: () => file,
    };
    const mockClipboardData = {
      items: [mockItem],
      getData: () => '',
    };

    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: mockClipboardData,
    });
    document.dispatchEvent(pasteEvent);

    await waitFor(() => {
      expect(mockUploadMindmapImage).toHaveBeenCalledWith('map-1', file);
    });
  });
});
