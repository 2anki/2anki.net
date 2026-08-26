import {
  Handle,
  type NodeProps,
  NodeResizer,
  NodeToolbar,
  Position,
} from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import ArrowUpTrayIcon from '../../components/icons/ArrowUpTrayIcon';
import PencilIcon from '../../components/icons/PencilIcon';
import SwatchIcon from '../../components/icons/SwatchIcon';
import TrashIcon from '../../components/icons/TrashIcon';

export interface MindmapImageMeta {
  url: string | null;
  width: number;
  height: number;
  missing?: true;
}

export interface MindmapNodeData {
  label: string;
  editing?: boolean;
  color?: string | null;
  image?: MindmapImageMeta;
  uploading?: boolean;
  onCommit?: (label: string) => void;
  onCancel?: () => void;
  onStartRename?: () => void;
  onCenter?: () => void;
  onSetColor?: (color: string | null) => void;
  onDelete?: () => void;
  onResizeEnd?: (width: number, height: number) => void;
  onReplaceImage?: (file: File) => void;
  [key: string]: unknown;
}

const COLOR_PRESETS: Array<{ labelKey: string; value: string | null }> = [
  { labelKey: 'mindmaps.colorDefault', value: null },
  { labelKey: 'mindmaps.colorBlue', value: '#3b82f6' },
  { labelKey: 'mindmaps.colorGreen', value: '#10b981' },
  { labelKey: 'mindmaps.colorAmber', value: '#f59e0b' },
  { labelKey: 'mindmaps.colorRed', value: '#ef4444' },
  { labelKey: 'mindmaps.colorPurple', value: '#8b5cf6' },
];

const toolbarButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '0.25rem',
  cursor: 'pointer',
  color: 'var(--color-text-primary)',
  width: '28px',
  height: '28px',
};

function CenterIcon({
  width = 16,
  height = 16,
}: Readonly<{ width?: number; height?: number }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width={width}
      height={height}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v3M12 18v3M3 12h3M18 12h3"
      />
    </svg>
  );
}

export function MindmapNode({ data, selected }: NodeProps) {
  const { t } = useTranslation('tools');
  const nodeData = data as MindmapNodeData;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  useEffect(() => {
    if (nodeData.editing && inputRef.current != null) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [nodeData.editing]);

  useEffect(() => {
    if (!selected) setColorPickerOpen(false);
  }, [selected]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const trimmed = inputRef.current?.value.trim() ?? '';
      nodeData.onCommit?.(trimmed.length > 0 ? trimmed : nodeData.label);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      nodeData.onCancel?.();
    }
  }

  function handleBlur() {
    const trimmed = inputRef.current?.value.trim() ?? '';
    nodeData.onCommit?.(trimmed.length > 0 ? trimmed : nodeData.label);
  }

  return (
    <>
      <NodeToolbar
        isVisible={selected === true && nodeData.editing !== true}
        position={Position.Top}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.25rem',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: '0.25rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.125rem' }}>
            <button
              type="button"
              title={t('mindmaps.rename')}
              aria-label={t('mindmaps.rename')}
              onClick={() => nodeData.onStartRename?.()}
              style={toolbarButtonStyle}
            >
              <PencilIcon width={16} height={16} />
            </button>
            {nodeData.image != null && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  aria-label={t('mindmaps.replaceImageFile')}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file != null) nodeData.onReplaceImage?.(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  title={t('mindmaps.replaceImage')}
                  aria-label={t('mindmaps.replaceImage')}
                  onClick={() => fileInputRef.current?.click()}
                  style={toolbarButtonStyle}
                >
                  <ArrowUpTrayIcon width={16} height={16} />
                </button>
              </>
            )}
            <button
              type="button"
              title={t('mindmaps.centerNode')}
              aria-label={t('mindmaps.centerNode')}
              onClick={() => nodeData.onCenter?.()}
              style={toolbarButtonStyle}
            >
              <CenterIcon />
            </button>
            <button
              type="button"
              title={t('mindmaps.color')}
              aria-label={t('mindmaps.color')}
              onClick={() => setColorPickerOpen((o) => !o)}
              style={toolbarButtonStyle}
            >
              <SwatchIcon width={16} height={16} />
            </button>
            <button
              type="button"
              title={t('mindmaps.delete')}
              aria-label={t('mindmaps.delete')}
              onClick={() => nodeData.onDelete?.()}
              style={{ ...toolbarButtonStyle, color: 'var(--color-danger)' }}
            >
              <TrashIcon width={16} height={16} />
            </button>
          </div>
          {colorPickerOpen && (
            <div
              style={{ display: 'flex', gap: '0.25rem', padding: '0.25rem' }}
            >
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.labelKey}
                  type="button"
                  title={t(c.labelKey)}
                  aria-label={t(c.labelKey)}
                  onClick={() => {
                    nodeData.onSetColor?.(c.value);
                    setColorPickerOpen(false);
                  }}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: '1px solid var(--color-border)',
                    background: c.value ?? 'var(--color-bg-secondary)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </NodeToolbar>
      <NodeResizer
        isVisible={selected === true && nodeData.editing !== true}
        minWidth={120}
        minHeight={36}
        keepAspectRatio={nodeData.image != null}
        onResizeEnd={(_e, params) =>
          nodeData.onResizeEnd?.(params.width, params.height)
        }
        lineStyle={{ border: '1px dashed var(--color-primary)' }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: 'var(--color-primary)',
        }}
      />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      {nodeData.uploading === true && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.7)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('mindmaps.uploading')}
        </div>
      )}
      {nodeData.editing ? (
        <textarea
          ref={inputRef}
          defaultValue={nodeData.label}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          cols={1}
          rows={1}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'var(--text-sm)',
            width: '100%',
            height: '100%',
            minWidth: 0,
            color: 'var(--color-text-primary)',
            fontFamily: 'inherit',
            lineHeight: 1.4,
            resize: 'none',
            padding: 0,
            margin: 0,
            overflow: 'auto',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            userSelect: 'none',
            width: '100%',
            height: '100%',
            overflow: 'auto',
            lineHeight: 1.4,
            boxSizing: 'border-box',
          }}
        >
          {nodeData.image != null && nodeData.image.missing === true && (
            <div
              style={{
                border: '1px dashed var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.5rem',
                marginBottom: nodeData.label.length > 0 ? '0.25rem' : 0,
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-tertiary)',
                minHeight: '2rem',
              }}
            >
              {t('mindmaps.imageUnavailable')}
            </div>
          )}
          {nodeData.image != null &&
            nodeData.image.missing !== true &&
            nodeData.image.url != null && (
              <img
                src={nodeData.image.url}
                alt={nodeData.label}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  display: 'block',
                  marginBottom: nodeData.label.length > 0 ? '0.25rem' : 0,
                }}
              />
            )}
          {nodeData.label.length > 0 && <Markdown>{nodeData.label}</Markdown>}
        </div>
      )}
      <Handle type="source" position={Position.Right} id="right" />
    </>
  );
}
