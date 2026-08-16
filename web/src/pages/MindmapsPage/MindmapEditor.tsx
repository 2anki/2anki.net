import '@xyflow/react/dist/style.css';
import {
  addEdge,
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useParams } from 'react-router-dom';
import PencilIcon from '../../components/icons/PencilIcon';
import { track } from '../../lib/analytics/track';
import { useDialogFocus } from '../../lib/hooks/useDialogFocus';
import shared from '../../styles/shared.module.css';
import { layoutGraph, NODE_HEIGHT } from './layoutGraph';
import styles from './MindmapEditor.module.css';
import { MindmapMarkdownModal } from './MindmapMarkdownModal';
import { MindmapNode } from './MindmapNode';
import type { MindmapData } from './useMindmap';
import {
  exportMindmap,
  type MindmapCardType,
  uploadMindmapImage,
  useMindmapById,
  useMindmapList,
  useUpdateMindmap,
} from './useMindmap';

const FREE_NODE_LIMIT = 50;
const NODE_STYLE = {
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-primary)',
  boxShadow: 'var(--shadow-sm)',
  padding: '0.5rem 1rem',
  fontSize: 'var(--text-sm)',
  boxSizing: 'border-box' as const,
};

function buildShortcutGroups(t: TFunction<'tools'>): {
  label: string;
  items: { keys: string[]; action: string }[];
}[] {
  return [
    {
      label: t('mindmaps.shortcutCreate'),
      items: [
        { keys: ['Tab'], action: t('mindmaps.actionAddChild') },
        { keys: ['Enter'], action: t('mindmaps.actionAddSibling') },
        {
          keys: [t('mindmaps.gestureDoubleClickCanvas')],
          action: t('mindmaps.actionAddNode'),
        },
        {
          keys: [t('mindmaps.gestureDragFromNode')],
          action: t('mindmaps.actionNewConnected'),
        },
        {
          keys: [t('mindmaps.gesturePasteText')],
          action: t('mindmaps.actionNewNode'),
        },
        {
          keys: [t('mindmaps.gesturePasteImage')],
          action: t('mindmaps.actionImageNode'),
        },
      ],
    },
    {
      label: t('mindmaps.shortcutEdit'),
      items: [
        {
          keys: ['F2', t('mindmaps.gestureDoubleClick')],
          action: t('mindmaps.actionRenameNode'),
        },
        { keys: ['Backspace'], action: t('mindmaps.actionDelete') },
        {
          keys: [t('mindmaps.gestureDoubleClickBorder')],
          action: t('mindmaps.actionAutoSize'),
        },
        { keys: ['Ctrl/Cmd+L'], action: t('mindmaps.actionTidyLayout') },
      ],
    },
    {
      label: t('mindmaps.shortcutSelect'),
      items: [
        { keys: ['Ctrl/Cmd+A'], action: t('mindmaps.actionSelectAll') },
        { keys: ['Esc'], action: t('mindmaps.actionClearSelection') },
        {
          keys: [t('mindmaps.gestureRightClick')],
          action: t('mindmaps.actionContextMenu'),
        },
        {
          keys: [t('mindmaps.gestureClickEdge')],
          action: t('mindmaps.actionEdgeMenu'),
        },
      ],
    },
  ];
}

function ChevronLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={14}
      height={14}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 19.5 8.25 12l7.5-7.5"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={14}
      height={14}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m8.25 4.5 7.5 7.5-7.5 7.5"
      />
    </svg>
  );
}

interface ExportModalProps {
  defaultName: string;
  basicCardCount: number;
  clozeCardCount: number;
  onExport: (deckName: string, cardType: MindmapCardType) => void;
  onClose: () => void;
  exporting: boolean;
}

function ExportModal({
  defaultName,
  basicCardCount,
  clozeCardCount,
  onExport,
  onClose,
  exporting,
}: Readonly<ExportModalProps>) {
  const { t } = useTranslation('tools');
  const [deckName, setDeckName] = useState(defaultName);
  const [cardType, setCardType] = useState<MindmapCardType>('basic');
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

  function cardCountLabel(): string {
    let count = clozeCardCount;
    if (cardType === 'markmap') count = 1;
    else if (cardType === 'basic') count = basicCardCount;
    return t('mindmaps.cardCount', { count });
  }

  return (
    <div className={styles.exportModal}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mindmap-export-title"
        className={styles.exportCard}
      >
        <h2 id="mindmap-export-title" className={styles.exportTitle}>
          {t('mindmaps.downloadDeck')}
        </h2>
        <label className={styles.exportLabel}>{t('mindmaps.deckName')}</label>
        <input
          type="text"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          className={styles.exportInput}
        />
        <fieldset className={styles.exportFieldset}>
          <legend className={styles.exportLegend}>
            {t('mindmaps.cardType')}
          </legend>
          <label className={styles.exportRadioLabel}>
            <input
              type="radio"
              name="card-type"
              value="basic"
              checked={cardType === 'basic'}
              onChange={() => setCardType('basic')}
            />
            {t('mindmaps.basicOption')}
          </label>
          <label className={styles.exportRadioLabel}>
            <input
              type="radio"
              name="card-type"
              value="cloze"
              checked={cardType === 'cloze'}
              onChange={() => setCardType('cloze')}
            />
            {t('mindmaps.clozeOption')}
          </label>
          <label className={styles.exportRadioLabel}>
            <input
              type="radio"
              name="card-type"
              value="markmap"
              checked={cardType === 'markmap'}
              onChange={() => setCardType('markmap')}
            />
            {t('mindmaps.wholeMapOption')}
          </label>
        </fieldset>
        <p className={styles.exportCount}>{cardCountLabel()}</p>
        <div className={styles.exportFooter}>
          <button
            type="button"
            onClick={onClose}
            className={`${shared.btnSecondary} ${shared.btnInline}`}
          >
            {t('mindmaps.cancel')}
          </button>
          <button
            type="button"
            disabled={exporting || deckName.trim().length === 0}
            onClick={() => onExport(deckName.trim(), cardType)}
            className={`${shared.btnPrimary} ${shared.btnInline}`}
          >
            {t('mindmaps.downloadDeck')}
          </button>
        </div>
      </div>
    </div>
  );
}

function readSidebarCollapsed(): boolean {
  if (typeof globalThis.window === 'undefined') return false;
  return localStorage.getItem('mindmap-editor.sidebar.collapsed') === '1';
}

export function MindmapEditor() {
  const { t } = useTranslation('tools');
  const { id } = useParams<{ id: string }>();
  const { data: map } = useMindmapById(id ?? null);
  const { data: mindmapList } = useMindmapList();
  const nodeLimit = mindmapList?.access.maxNodesPerMap ?? FREE_NODE_LIMIT;
  const updateMindmap = useUpdateMindmap(id ?? '');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string | null;
    edgeId?: string;
    flowX?: number;
    flowY?: number;
  } | null>(null);
  const [rfInstance, setRfInstanceState] = useState<ReactFlowInstance | null>(
    null
  );
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState<boolean>(readSidebarCollapsed);
  const [showMarkdownModal, setShowMarkdownModal] = useState(false);
  const [showMobileHint, setShowMobileHint] = useState(true);

  const setRfInstance = useCallback((instance: ReactFlowInstance) => {
    setRfInstanceState(instance);
    if (fitViewPending.current) {
      fitViewPending.current = false;
      instance.fitView({ duration: 0 });
    }
  }, []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitViewPending = useRef(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (
      titleRef.current != null &&
      document.activeElement !== titleRef.current
    ) {
      titleRef.current.innerText = map?.title ?? t('mindmaps.untitled');
    }
  }, [map?.title, t]);

  function commitTitle(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed === (map?.title ?? '')) return;
    updateMindmap.mutate({ title: trimmed });
  }

  const seededMapId = useRef<string | null>(null);

  useEffect(() => {
    if (map == null) return;

    if (seededMapId.current === map.id) {
      setNodes((current) =>
        current.map((n) => {
          const serverNode = map.data.nodes.find((sn) => sn.id === n.id);
          if (serverNode == null) return n;
          const dataChanged =
            serverNode.label !== (n.data as { label?: string }).label ||
            (serverNode.color ?? null) !==
              (n.data as { color?: string | null }).color;
          if (!dataChanged) return n;
          return {
            ...n,
            data: {
              ...n.data,
              label: serverNode.label,
              color: serverNode.color ?? null,
            },
            style:
              serverNode.color == null
                ? NODE_STYLE
                : {
                    ...NODE_STYLE,
                    borderColor: serverNode.color,
                    boxShadow: `0 0 0 1px ${serverNode.color}`,
                  },
          };
        })
      );
      return;
    }

    seededMapId.current = map.id;

    const someHasPosition = map.data.nodes.some((n) => n.position != null);

    const rfNodes: Node[] = map.data.nodes.map((n) => ({
      id: n.id,
      type: 'mindmap',
      data: { label: n.label, color: n.color ?? null, image: n.image ?? null },
      position: n.position ?? { x: 0, y: 0 },
      width: n.width,
      height: n.height,
      style:
        n.color == null
          ? NODE_STYLE
          : {
              ...NODE_STYLE,
              borderColor: n.color,
              boxShadow: `0 0 0 1px ${n.color}`,
            },
    }));
    const rfEdges: Edge[] = map.data.edges.map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      style: { stroke: 'var(--color-border)' },
    }));

    const initialNodes = someHasPosition
      ? rfNodes
      : layoutGraph(rfNodes, rfEdges);
    setNodes(initialNodes);
    setEdges(rfEdges);
    if (rfInstance == null) {
      fitViewPending.current = true;
    } else {
      rfInstance.fitView({ duration: 0 });
    }
    if (initialNodes.length === 1) {
      setSelectedNodeId(initialNodes[0].id);
    }
  }, [map, setNodes, setEdges, rfInstance]);

  const persistData = useCallback(
    (ns: Node[], es: Edge[]) => {
      if (saveTimer.current != null) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const data: MindmapData = {
          nodes: ns.map((n) => ({
            id: n.id,
            label: String(n.data.label ?? ''),
            position: { x: n.position.x, y: n.position.y },
            width: n.width,
            height: n.height,
            color: (n.data as { color?: string | null }).color ?? null,
            image:
              (n.data as { image?: MindmapData['nodes'][number]['image'] })
                .image ?? undefined,
          })),
          edges: es.map((e) => ({ source: e.source, target: e.target })),
        };
        updateMindmap.mutate({ data });
      }, 800);
    },
    [updateMindmap]
  );

  const commitLabel = useCallback(
    (nodeId: string, label: string) => {
      setNodes((ns) => {
        const updated = ns.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, label, editing: false } }
            : n
        );
        persistData(updated, edges);
        return updated;
      });
    },
    [setNodes, persistData, edges]
  );

  const cancelEdit = useCallback(
    (nodeId: string) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, editing: false } } : n
        )
      );
    },
    [setNodes]
  );

  const centerOnNode = useCallback(
    (nodeId: string) => {
      rfInstance?.fitView({
        nodes: [{ id: nodeId }],
        duration: 300,
        maxZoom: 1.2,
      });
    },
    [rfInstance]
  );

  const setNodeColor = useCallback(
    (nodeId: string, color: string | null) => {
      setNodes((ns) => {
        const updated = ns.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: { ...n.data, color },
                style:
                  color == null
                    ? NODE_STYLE
                    : {
                        ...NODE_STYLE,
                        borderColor: color,
                        boxShadow: `0 0 0 1px ${color}`,
                      },
              }
            : n
        );
        persistData(updated, edges);
        return updated;
      });
    },
    [setNodes, persistData, edges]
  );

  const replaceNodeImage = useCallback(
    async (nodeId: string, file: File) => {
      if (id == null) return;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, uploading: true } } : n
        )
      );
      try {
        const imageResult = await uploadMindmapImage(id, file);
        setNodes((ns) => {
          const updated = ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, uploading: false, image: imageResult },
                }
              : n
          );
          persistData(updated, edges);
          return updated;
        });
      } catch {
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, uploading: false } }
              : n
          )
        );
        setToast(t('mindmaps.imageUploadError'));
        setTimeout(() => setToast(null), 4000);
      }
    },
    [id, setNodes, persistData, edges, setToast, t]
  );

  const handleImageFile = useCallback(
    async (file: File, position: { x: number; y: number }) => {
      if (id == null) return;
      const newId = crypto.randomUUID();
      const placeholderNode: Node = {
        id: newId,
        type: 'mindmap',
        data: { label: '', uploading: true },
        position,
        style: NODE_STYLE,
      };
      setNodes((ns) => {
        const updated = [...ns, placeholderNode];
        persistData(updated, edges);
        return updated;
      });
      setSelectedNodeId(newId);

      try {
        const imageResult = await uploadMindmapImage(id, file);
        setNodes((ns) => {
          const updated = ns.map((n) =>
            n.id === newId
              ? {
                  ...n,
                  data: { ...n.data, uploading: false, image: imageResult },
                }
              : n
          );
          persistData(updated, edges);
          return updated;
        });
      } catch {
        setNodes((ns) => ns.filter((n) => n.id !== newId));
        setToast(t('mindmaps.imageUploadError'));
        setTimeout(() => setToast(null), 4000);
      }
    },
    [id, setNodes, persistData, edges, setToast, t]
  );

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable)
          return;
      }

      const imageItem = Array.from(e.clipboardData?.items ?? []).find(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );

      if (imageItem != null) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file == null) return;
        const center =
          rfInstance == null
            ? { x: 0, y: 0 }
            : rfInstance.screenToFlowPosition({
                x: window.innerWidth / 2,
                y: window.innerHeight / 2,
              });
        handleImageFile(file, center);
        return;
      }

      if (rfInstance == null) return;
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (text == null || text.length === 0) return;
      e.preventDefault();
      const center = rfInstance.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const newId = crypto.randomUUID();
      const newNode: Node = {
        id: newId,
        type: 'mindmap',
        data: { label: text },
        position: center,
        style: NODE_STYLE,
      };
      setNodes((ns) => {
        const updated = [...ns, newNode];
        persistData(updated, edges);
        return updated;
      });
      setSelectedNodeId(newId);
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [rfInstance, setNodes, persistData, edges, handleImageFile]);

  const setNodeSize = useCallback(
    (nodeId: string, width: number, height: number) => {
      setNodes((ns) => {
        const updated = ns.map((n) =>
          n.id === nodeId ? { ...n, width, height } : n
        );
        persistData(updated, edges);
        return updated;
      });
    },
    [setNodes, persistData, edges]
  );

  const autoSizeNode = useCallback(
    (nodeId: string) => {
      setNodes((ns) => {
        const updated = ns.map((n) => {
          if (n.id !== nodeId) return n;
          const next = { ...n };
          delete (next as { width?: number }).width;
          delete (next as { height?: number }).height;
          return next;
        });
        persistData(updated, edges);
        return updated;
      });
    },
    [setNodes, persistData, edges]
  );

  const nodeTypes = useMemo(
    () => ({
      mindmap: (props: Parameters<typeof MindmapNode>[0]) => (
        <MindmapNode
          {...props}
          data={{
            ...props.data,
            onCommit: (label: string) => commitLabel(props.id, label),
            onCancel: () => cancelEdit(props.id),
            onStartRename: () => startRename(props.id),
            onCenter: () => centerOnNode(props.id),
            onSetColor: (color: string | null) => setNodeColor(props.id, color),
            onDelete: () => deleteNode(props.id),
            onResizeEnd: (width: number, height: number) =>
              setNodeSize(props.id, width, height),
            onReplaceImage: (file: File) => replaceNodeImage(props.id, file),
          }}
        />
      ),
    }),
    [
      commitLabel,
      cancelEdit,
      centerOnNode,
      setNodeColor,
      setNodeSize,
      startRename,
      deleteNode,
      replaceNodeImage,
    ]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((es) => {
        const updated = addEdge(connection, es);
        persistData(nodes, updated);
        return updated;
      });
    },
    [nodes, setEdges, persistData]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const remaining = edges.filter(
        (e) => !deleted.some((d) => d.id === e.id)
      );
      persistData(nodes, remaining);
    },
    [nodes, edges, persistData]
  );

  function deleteEdge(edgeId: string) {
    const updatedEdges = edges.filter((e) => e.id !== edgeId);
    setEdges(updatedEdges);
    persistData(nodes, updatedEdges);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function addChildNode(parentId: string) {
    if (nodes.length >= nodeLimit) {
      showToast(t('mindmaps.nodeLimitReached', { limit: nodeLimit }));
      return;
    }
    const newId = crypto.randomUUID();
    const parentNode = nodes.find((n) => n.id === parentId);
    const newNode: Node = {
      id: newId,
      type: 'mindmap',
      data: { label: t('mindmaps.newNode'), editing: true },
      position: {
        x: (parentNode?.position.x ?? 0) + 200,
        y: (parentNode?.position.y ?? 0) + 50,
      },
      style: NODE_STYLE,
    };
    const newEdge: Edge = {
      id: `${parentId}-${newId}`,
      source: parentId,
      target: newId,
      style: { stroke: 'var(--color-border)' },
    };
    const updatedNodes = [...nodes, newNode];
    const updatedEdges = [...edges, newEdge];
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelectedNodeId(newId);
    persistData(updatedNodes, updatedEdges);
  }

  function addSiblingNode(siblingId: string) {
    if (nodes.length >= nodeLimit) {
      showToast(t('mindmaps.nodeLimitReached', { limit: nodeLimit }));
      return;
    }
    const parentEdge = edges.find((e) => e.target === siblingId);
    const parentId = parentEdge?.source ?? null;
    const newId = crypto.randomUUID();
    const siblingNode = nodes.find((n) => n.id === siblingId);
    const newNode: Node = {
      id: newId,
      type: 'mindmap',
      data: { label: t('mindmaps.newNode'), editing: true },
      position: {
        x: siblingNode?.position.x ?? 0,
        y: (siblingNode?.position.y ?? 0) + NODE_HEIGHT + 20,
      },
      style: NODE_STYLE,
    };

    const updatedNodes = [...nodes, newNode];
    const updatedEdges =
      parentId == null
        ? [...edges]
        : [
            ...edges,
            {
              id: `${parentId}-${newId}`,
              source: parentId,
              target: newId,
              style: { stroke: 'var(--color-border)' },
            },
          ];

    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelectedNodeId(newId);
    persistData(updatedNodes, updatedEdges);
  }

  function deleteNode(nodeId: string) {
    const childCount = edges.filter((e) => e.source === nodeId).length;
    if (childCount > 0) {
      const confirmed = window.confirm(t('mindmaps.deleteNodeConfirm'));
      if (!confirmed) return;
    }
    const updatedNodes = nodes.filter((n) => n.id !== nodeId);
    const updatedEdges = edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelectedNodeId(null);
    persistData(updatedNodes, updatedEdges);
  }

  function startRename(nodeId: string) {
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== nodeId) return n;
        const measured = (
          n as Node & { measured?: { width?: number; height?: number } }
        ).measured;
        return {
          ...n,
          data: { ...n.data, editing: true },
          width: n.width ?? measured?.width,
          height: n.height ?? measured?.height,
        };
      })
    );
  }

  function handleTidy() {
    if (nodes.length === 0) return;
    const laidOut = layoutGraph(nodes, edges);
    setNodes(laidOut);
    persistData(laidOut, edges);
    rfInstance?.fitView({ duration: 300 });
    showToast(t('mindmaps.layoutUpdated'));
  }

  function createNodeAt(
    position: { x: number; y: number },
    parentId?: string | null
  ) {
    if (nodes.length >= nodeLimit) {
      showToast(t('mindmaps.nodeLimitReached', { limit: nodeLimit }));
      return;
    }
    const newId = crypto.randomUUID();
    const newNode: Node = {
      id: newId,
      type: 'mindmap',
      data: { label: t('mindmaps.newNode'), editing: true },
      position,
      style: NODE_STYLE,
    };
    const updatedNodes = [...nodes, newNode];
    const updatedEdges =
      parentId == null
        ? edges
        : [
            ...edges,
            {
              id: `${parentId}-${newId}`,
              source: parentId,
              target: newId,
              style: { stroke: 'var(--color-border)' },
            },
          ];
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelectedNodeId(newId);
    persistData(updatedNodes, updatedEdges);
  }

  useEffect(() => {
    if (contextMenu == null) return;
    function close() {
      setContextMenu(null);
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('click', close);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [contextMenu]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    }

    function isInsideDialog(target: EventTarget | null): boolean {
      return (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"]') != null
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target) || isInsideDialog(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleTidy();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
        return;
      }

      if (e.key === 'Escape') {
        setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
        setSelectedNodeId(null);
        return;
      }

      if (selectedNodeId == null) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        addChildNode(selectedNodeId);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        addSiblingNode(selectedNodeId);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        deleteNode(selectedNodeId);
      } else if (e.key === 'F2') {
        e.preventDefault();
        startRename(selectedNodeId);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const basicCardCount = edges.length;
  const leafNodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    leafNodeIds.delete(edge.source);
  }
  const clozeCardCount = leafNodeIds.size;

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(
        'mindmap-editor.sidebar.collapsed',
        next ? '1' : '0'
      );
      return next;
    });
  }

  async function handleExport(deckName: string, cardType: MindmapCardType) {
    if (id == null) return;
    setExporting(true);
    try {
      const { blob, excludedNodeCount } = await exportMindmap(
        id,
        deckName,
        cardType
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deckName}.apkg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowExport(false);
      if (excludedNodeCount > 0) {
        track('mindmap_export_excluded_nodes', {
          excluded_node_count: excludedNodeCount,
          card_type: cardType,
        });
        showToast(t('mindmaps.nodesExcluded', { count: excludedNodeCount }));
      } else {
        showToast(t('mindmaps.deckDownloaded'));
      }
    } finally {
      setExporting(false);
    }
  }

  const sidebarClass = `${styles.sidebar} ${styles.sidebarCollapsed}`;

  const editableTitle = (
    <h2
      ref={titleRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      title={t('mindmaps.clickToRename')}
      onBlur={(e) => {
        const text = e.currentTarget.innerText;
        if (text.trim().length === 0) {
          e.currentTarget.innerText = map?.title ?? t('mindmaps.untitled');
          return;
        }
        commitTitle(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.innerText = map?.title ?? t('mindmaps.untitled');
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      className={
        isMobile
          ? `${styles.sidebarTitle} ${styles.mobileTitle}`
          : styles.sidebarTitle
      }
    >
      {map?.title ?? t('mindmaps.untitled')}
    </h2>
  );

  return (
    <div
      data-testid="editor-root"
      className={styles.editorRoot}
      style={{ flexDirection: isMobile ? 'column' : 'row' }}
    >
      {isMobile ? (
        <div data-testid="editor-mobile-bar" className={styles.mobileBar}>
          <Link to="/mindmaps" className={styles.backLink}>
            <ChevronLeftIcon />
            {t('mindmaps.mindmapsBack')}
          </Link>
          {editableTitle}
          <button
            type="button"
            onClick={() => setShowExport(true)}
            className={`${shared.btnPrimary} ${shared.btnInline}`}
          >
            {t('mindmaps.downloadDeck')}
          </button>
        </div>
      ) : (
        <div
          data-testid="editor-sidebar"
          className={sidebarCollapsed ? sidebarClass : styles.sidebar}
        >
          <Link to="/mindmaps" className={styles.backLink}>
            <ChevronLeftIcon />
            {t('mindmaps.mindmapsBack')}
          </Link>

          {!sidebarCollapsed && (
            <button
              type="button"
              aria-label={t('mindmaps.collapseSidebar')}
              onClick={toggleSidebar}
              className={styles.collapseToggle}
            >
              <ChevronLeftIcon />
            </button>
          )}

          <div className={styles.sidebarTitleRow}>
            {editableTitle}
            <button
              type="button"
              aria-label={t('mindmaps.renameMap')}
              title={t('mindmaps.renameMap')}
              onClick={() => {
                if (titleRef.current == null) return;
                titleRef.current.focus();
                const range = document.createRange();
                range.selectNodeContents(titleRef.current);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }}
              className={styles.renameTrigger}
            >
              <PencilIcon width={14} height={14} />
            </button>
          </div>

          <p className={styles.statLine}>
            {t('mindmaps.nodeCount', { count: nodes.length })} ·{' '}
            {t('mindmaps.edgeCount', { count: edges.length })}
          </p>

          <details className={styles.shortcuts}>
            <summary className={styles.shortcutsSummary}>
              {t('mindmaps.keyboardShortcuts')}
            </summary>
            <div className={styles.shortcutsBody}>
              {buildShortcutGroups(t).map((group) => (
                <div key={group.label} className={styles.shortcutGroup}>
                  <p className={styles.shortcutGroupLabel}>{group.label}</p>
                  {group.items.map((item) => (
                    <div key={item.action} className={styles.shortcutRow}>
                      <span className={styles.shortcutKeys}>
                        {item.keys.map((key) => (
                          <kbd key={key} className={styles.shortcutKey}>
                            {key}
                          </kbd>
                        ))}
                      </span>
                      <span className={styles.shortcutAction}>
                        {item.action}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setShowMarkdownModal(true)}
                className={styles.shortcutNoteBtn}
              >
                {t('mindmaps.markdownWorks')}
              </button>
            </div>
          </details>

          <div className={styles.primaryAction}>
            <button
              type="button"
              onClick={() => setShowExport(true)}
              className={shared.btnPrimary}
            >
              {t('mindmaps.downloadDeck')}
            </button>
          </div>
        </div>
      )}

      <div
        data-testid="editor-canvas"
        style={{ flex: 1, position: 'relative' }}
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.react-flow__node') != null) return;
          if (target.closest('.react-flow__handle') != null) return;
          if (target.closest('.react-flow__controls') != null) return;
          if (rfInstance == null) return;
          const position = rfInstance.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          createNodeAt(position, null);
        }}
        onDragOver={(e) => {
          if (
            Array.from(e.dataTransfer.items).some((item) =>
              item.type.startsWith('image/')
            )
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (rfInstance == null) return;
          const file = Array.from(e.dataTransfer.files).find((f) =>
            f.type.startsWith('image/')
          );
          if (file == null) return;
          const position = rfInstance.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          handleImageFile(file, position);
        }}
      >
        {isMobile && showMobileHint && (
          <div className={styles.mobileHint}>
            <span>{t('mindmaps.tapDragHint')}</span>
            <button
              type="button"
              aria-label={t('mindmaps.dismissHint')}
              onClick={() => setShowMobileHint(false)}
              className={styles.mobileHintDismiss}
            >
              ×
            </button>
          </div>
        )}
        {!isMobile && sidebarCollapsed && (
          <button
            type="button"
            aria-label={t('mindmaps.expandSidebar')}
            onClick={toggleSidebar}
            className={styles.collapseReopenHandle}
          >
            <ChevronRightIcon />
          </button>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setRfInstance}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              nodeId: null,
              edgeId: edge.id,
            });
          }}
          onEdgeClick={(e, edge) => {
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              nodeId: null,
              edgeId: edge.id,
            });
          }}
          onConnectEnd={(e, connectionState) => {
            if (connectionState.toNode != null) return;
            if (rfInstance == null) return;
            const fromNodeId = connectionState.fromNode?.id;
            if (fromNodeId == null) return;
            const mouse =
              'changedTouches' in e ? e.changedTouches[0] : (e as MouseEvent);
            const flow = rfInstance.screenToFlowPosition({
              x: mouse.clientX,
              y: mouse.clientY,
            });
            createNodeAt(flow, fromNodeId);
          }}
          onNodeClick={(_e, node) => setSelectedNodeId(node.id)}
          onNodeDoubleClick={(e, node) => {
            const wrapper = (e.target as HTMLElement).closest(
              '.react-flow__node'
            ) as HTMLElement | null;
            if (wrapper != null) {
              const rect = wrapper.getBoundingClientRect();
              const borderZone = 6;
              const nearBorder =
                e.clientX - rect.left < borderZone ||
                rect.right - e.clientX < borderZone ||
                e.clientY - rect.top < borderZone ||
                rect.bottom - e.clientY < borderZone;
              if (nearBorder) {
                autoSizeNode(node.id);
                return;
              }
            }
            startRename(node.id);
          }}
          onNodeDragStop={() => persistData(nodes, edges)}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            setSelectedNodeId(node.id);
            setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            if (rfInstance == null) return;
            const flow = rfInstance.screenToFlowPosition({
              x: (e as MouseEvent).clientX,
              y: (e as MouseEvent).clientY,
            });
            setContextMenu({
              x: (e as MouseEvent).clientX,
              y: (e as MouseEvent).clientY,
              nodeId: null,
              flowX: flow.x,
              flowY: flow.y,
            });
          }}
          proOptions={{ hideAttribution: true }}
          connectionMode={ConnectionMode.Loose}
          snapToGrid
          snapGrid={[20, 20]}
        >
          <Controls />
          <Background />
        </ReactFlow>
        <button
          type="button"
          onClick={handleTidy}
          title={t('mindmaps.tidyLayoutTitle')}
          className={styles.tidyBtn}
        >
          {t('mindmaps.tidyLayout')}
        </button>
      </div>

      {showExport && (
        <ExportModal
          defaultName={map?.title ?? t('mindmaps.myDeck')}
          basicCardCount={basicCardCount}
          clozeCardCount={clozeCardCount}
          onExport={handleExport}
          onClose={() => setShowExport(false)}
          exporting={exporting}
        />
      )}

      {showMarkdownModal && (
        <MindmapMarkdownModal onClose={() => setShowMarkdownModal(false)} />
      )}

      {toast != null && (
        <div role="status" aria-live="polite" className={styles.toast}>
          {toast}
        </div>
      )}

      {contextMenu != null && (
        <div
          role="menu"
          // Both handlers only stop propagation so a click or key inside the
          // menu does not reach the dismiss handler on the surface behind it.
          // The menu's actual controls are the buttons within.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.edgeId != null && (
            <ContextMenuItem
              label={t('mindmaps.removeConnection')}
              shortcut="Backspace"
              onSelect={() => {
                if (contextMenu.edgeId != null) {
                  deleteEdge(contextMenu.edgeId);
                }
                setContextMenu(null);
              }}
            />
          )}
          {contextMenu.edgeId == null && contextMenu.nodeId != null && (
            <NodeContextMenu
              nodeId={contextMenu.nodeId}
              t={t}
              onAddChild={(nodeId) => {
                addChildNode(nodeId);
                setContextMenu(null);
              }}
              onAddSibling={(nodeId) => {
                addSiblingNode(nodeId);
                setContextMenu(null);
              }}
              onRename={(nodeId) => {
                setContextMenu(null);
                startRename(nodeId);
              }}
              onDelete={(nodeId) => {
                deleteNode(nodeId);
                setContextMenu(null);
              }}
            />
          )}
          {contextMenu.edgeId == null && contextMenu.nodeId == null && (
            <ContextMenuItem
              label={t('mindmaps.addNodeHere')}
              shortcut={t('mindmaps.gestureDoubleClick')}
              onSelect={() => {
                if (contextMenu.flowX != null && contextMenu.flowY != null) {
                  createNodeAt(
                    { x: contextMenu.flowX, y: contextMenu.flowY },
                    null
                  );
                }
                setContextMenu(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface ContextMenuItemProps {
  label: string;
  shortcut: string;
  onSelect: () => void;
}

function ContextMenuItem({
  label,
  shortcut,
  onSelect,
}: Readonly<ContextMenuItemProps>) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={styles.contextMenuItem}
    >
      <span>{label}</span>
      <span className={styles.contextMenuShortcut}>{shortcut}</span>
    </button>
  );
}

interface NodeContextMenuProps {
  nodeId: string;
  t: TFunction<'tools'>;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}

function NodeContextMenu({
  nodeId,
  t,
  onAddChild,
  onAddSibling,
  onRename,
  onDelete,
}: Readonly<NodeContextMenuProps>) {
  return (
    <>
      <ContextMenuItem
        label={t('mindmaps.actionAddChild')}
        shortcut="Tab"
        onSelect={() => onAddChild(nodeId)}
      />
      <ContextMenuItem
        label={t('mindmaps.actionAddSibling')}
        shortcut="Enter"
        onSelect={() => onAddSibling(nodeId)}
      />
      <ContextMenuItem
        label={t('mindmaps.rename')}
        shortcut="F2"
        onSelect={() => onRename(nodeId)}
      />
      <ContextMenuItem
        label={t('mindmaps.delete')}
        shortcut="Backspace"
        onSelect={() => onDelete(nodeId)}
      />
    </>
  );
}
