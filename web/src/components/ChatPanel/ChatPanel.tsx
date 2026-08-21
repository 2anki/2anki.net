import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics/track';
import { patch, post, postMultipart } from '../../lib/backend/api';
import {
  type ChatCardTemplate,
  DEFAULT_TEMPLATE,
  effectiveTemplateForCards,
  isPureClientReshape,
  suggestDeckName,
} from '../../lib/chat/templates';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { isPayingUser } from '../NavigationBar/helpers/getPlanLabel';
import sharedStyles from '../../styles/shared.module.css';
import { compressImageForUpload } from '../../lib/image/compressImageForUpload';
import AssistantMarkdown from '../../pages/Chat/AssistantMarkdown';
import CardPreview from '../../pages/Chat/CardPreview';
import ConsentModal from '../ConsentModal/ConsentModal';
import { ALLOWED_ATTACHMENT_TYPES, ATTACHMENT_ACCEPT } from './attachmentTypes';
import styles from './ChatPanel.module.css';
import { TemplateSelector } from './TemplateSelector';

export interface ChatCard {
  front: string;
  back: string;
  tags?: string[];
  options?: string[];
  correctIndex?: number;
  rationale?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  contentBefore?: string;
  contentAfter?: string;
  cards?: ChatCard[];
}

interface ApiDonePayload {
  content: string;
  conversationId: number;
  contentBefore?: string;
  contentAfter?: string;
  cards?: ChatCard[];
}

interface ApiErrorPayload {
  type:
    | 'server_error'
    | 'conversation_not_found'
    | 'consent_required'
    | 'attachments_not_replayable';
}

export interface ChatPanelProps {
  initialPrompt?: string;
  cameFromUpload?: boolean;
  onCardsGenerated?: (cards: ChatCard[]) => void;
  initialConversationId?: number | null;
  initialMessages?: Message[];
  initialTemplateSlug?: ChatCardTemplate | null;
  initialTitle?: string;
  onConversationCreated?: (id: number, title: string) => void;
  onConversationNotFound?: () => void;
  onTemplateChange?: (slug: ChatCardTemplate) => void;
}

const DRAFT_DEBOUNCE_MS = 500;

type ChipState = 'idle' | 'uploading' | 'failed';

interface AttachmentChip {
  id: string;
  file: File;
  state: ChipState;
  retryCount: number;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_FILE_COUNT = 5;

const TAG_SUCCESS_DISMISS_MS = 3000;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findLastAssistantWithCardsIdx(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.cards != null && m.cards.length > 0) {
      return i;
    }
  }
  return -1;
}

function findLastAssistantIdx(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return i;
    }
  }
  return -1;
}

export function parseSseEvent(
  rawEvent: string
): { eventType: string; data: string } | null {
  if (!rawEvent.trim()) return null;
  let eventType = '';
  let data = '';
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }
  if (eventType === '') return null;
  return { eventType, data };
}

export async function consumeSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventType: string, data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const rawEvent of events) {
      const parsed = parseSseEvent(rawEvent);
      if (parsed != null) onEvent(parsed.eventType, parsed.data);
    }
  }
}

async function downloadDeck(
  cards: ChatCard[],
  deckName: string,
  templateSlug: ChatCardTemplate
): Promise<void> {
  const response = await post('/api/chat/deck', {
    cards,
    deckName,
    templateSlug,
  });
  if (!response.ok) {
    throw new Error('Failed to generate deck');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deckName}.apkg`;
  a.click();
  URL.revokeObjectURL(url);
}

function findRawArrayStart(text: string): number {
  let lineStart = 0;
  let isFirstLine = true;
  while (lineStart <= text.length) {
    let i = lineStart;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    if (text[i] === '[') {
      let j = i + 1;
      while (
        j < text.length &&
        (text[j] === ' ' ||
          text[j] === '\t' ||
          text[j] === '\n' ||
          text[j] === '\r')
      ) {
        j++;
      }
      if (text[j] === '{') return isFirstLine ? 0 : lineStart - 1;
    }
    const next = text.indexOf('\n', lineStart);
    if (next === -1) return -1;
    lineStart = next + 1;
    isFirstLine = false;
  }
  return -1;
}

function visibleStreamingText(text: string): string {
  const fenceIndex = text.search(/(?:^|\n)```json/);
  if (fenceIndex !== -1) return text.slice(0, fenceIndex);
  const rawArrayIndex = findRawArrayStart(text);
  return rawArrayIndex === -1 ? text : text.slice(0, rawArrayIndex);
}

function chipIcon(mimeType: string): string {
  return mimeType === 'application/pdf' ? '📄' : '🖼';
}

function truncateName(name: string, max: number): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && name.length - ext <= 6) {
    const truncated = name.slice(0, max - 3 - (name.length - ext));
    return `${truncated}…${name.slice(ext)}`;
  }
  return `${name.slice(0, max - 1)}…`;
}

function UserMessage({
  message,
  expanded,
  onToggleExpand,
}: {
  message: Message;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation('chat');
  const isLong =
    message.content.length > 600 || message.content.split('\n').length > 12;
  return (
    <div className={styles.userRow} aria-label={t('message.userMessage')}>
      <div
        className={`${styles.userBubble} ${isLong && !expanded ? styles.userBubbleClamped : ''}`}
      >
        {message.content}
      </div>
      {isLong && (
        <button
          type="button"
          className={styles.expandToggle}
          onClick={onToggleExpand}
          aria-expanded={expanded}
        >
          {expanded ? t('message.showLess') : t('message.showFull')}
        </button>
      )}
    </div>
  );
}

function messageDeckName(
  message: Message,
  conversationTitle?: string
): string | undefined {
  const messageText = [
    message.contentBefore,
    message.content,
    message.contentAfter,
  ]
    .filter((s): s is string => s != null)
    .join('\n');
  return suggestDeckName(messageText, conversationTitle) ?? undefined;
}

function AssistantMessage({
  message,
  onSave,
  template,
  onTemplateChange,
  showSelectorWithoutCards,
  templateDisabled,
  isRegenerating,
  onAddTags,
  isTagging,
  conversationTitle,
}: {
  message: Message;
  onSave?: (cards: ChatCard[], deckName: string) => void;
  template?: ChatCardTemplate;
  onTemplateChange?: (slug: ChatCardTemplate) => void;
  showSelectorWithoutCards?: boolean;
  templateDisabled?: boolean;
  isRegenerating?: boolean;
  onAddTags?: () => void;
  isTagging?: boolean;
  conversationTitle?: string;
}) {
  const hasCards = message.cards != null && message.cards.length > 0;
  const selectorOnlyPreview =
    showSelectorWithoutCards === true && !hasCards && onTemplateChange != null;
  const showCardPreview =
    (hasCards && onSave != null) ||
    isRegenerating === true ||
    selectorOnlyPreview;
  return (
    <div className={styles.assistantRow}>
      {message.contentBefore != null && (
        <AssistantMarkdown>{message.contentBefore}</AssistantMarkdown>
      )}
      {message.cards == null && !isRegenerating && (
        <AssistantMarkdown>{message.content}</AssistantMarkdown>
      )}
      {showCardPreview && (
        <CardPreview
          cards={message.cards ?? []}
          onSave={
            onSave != null && message.cards != null
              ? (deckName) => onSave(message.cards!, deckName)
              : undefined
          }
          template={template}
          onTemplateChange={onTemplateChange}
          templateDisabled={templateDisabled}
          isRegenerating={isRegenerating}
          onAddTags={onAddTags}
          isTagging={isTagging}
          suggestedDeckName={messageDeckName(message, conversationTitle)}
        />
      )}
      {message.contentAfter != null && (
        <AssistantMarkdown>{message.contentAfter}</AssistantMarkdown>
      )}
    </div>
  );
}

function StreamingMessage({
  streamingText,
  isCardStreaming,
}: {
  streamingText: string;
  isCardStreaming: boolean;
}) {
  const { t } = useTranslation('chat');
  if (streamingText.length > 0) {
    return (
      <div className={styles.assistantRow}>
        <AssistantMarkdown isStreaming={!isCardStreaming}>
          {visibleStreamingText(streamingText)}
        </AssistantMarkdown>
        {isCardStreaming && (
          <span className={styles.makingCards}>
            {t('composer.writingCards')}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={styles.thinkingPill}
      aria-label={t('composer.thinking')}
      role="status"
    >
      <span className={styles.srOnly}>{t('composer.thinking')}</span>
    </div>
  );
}

interface ComposerProps {
  inputValue: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAttach: (files: File[]) => void;
  attachedFiles: AttachmentChip[];
  onRemoveFile: (id: string) => void;
  onRetryFile?: (id: string) => void;
  disabled: boolean;
  isDragging?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

function ComposerPill({
  inputValue,
  onChange,
  onSubmit,
  onAttach,
  attachedFiles,
  onRemoveFile,
  onRetryFile,
  disabled,
  isDragging = false,
  onDragOver,
  onDragLeave,
  onDrop,
  textareaRef: externalTextareaRef,
}: ComposerProps) {
  const { t } = useTranslation('chat');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? internalRef;

  const hasContent =
    inputValue.trim().length > 0 ||
    attachedFiles.filter((c) => c.state === 'idle').length > 0;
  const canSend = hasContent && !disabled;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSubmit();
      }
    }
  }

  return (
    <div
      role="region"
      aria-label={t('composer.region')}
      className={`${styles.composerPill} ${isDragging ? styles.composerPillDragging : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className={styles.dropOverlay}>
          <span className={styles.dropOverlayTitle}>
            {t('composer.dropToAttach')}
          </span>
          <span className={styles.dropOverlaySub}>
            {t('composer.dropHint')}
          </span>
        </div>
      )}
      {attachedFiles.length > 0 && (
        <div className={styles.chipStrip}>
          {attachedFiles.map((chip) => (
            <div
              key={chip.id}
              className={`${styles.chip} ${chip.state === 'failed' ? styles.chipError : ''}`}
            >
              <span className={styles.chipIcon}>
                {chipIcon(chip.file.type)}
              </span>
              <span className={styles.chipName} title={chip.file.name}>
                {truncateName(chip.file.name, 32)}
              </span>
              <span className={styles.chipSeparator}> · </span>
              {chip.state === 'uploading' && (
                <>
                  <span
                    className={`${styles.chipSize} ${styles.chipSizeError}`}
                  >
                    <span className={styles.spinnerSmall} />
                  </span>
                  <span className={styles.chipSize}>
                    {t('composer.uploading')}
                  </span>
                </>
              )}
              {chip.state === 'failed' && (
                <>
                  <span
                    className={`${styles.chipSize} ${styles.chipSizeError}`}
                  >
                    {t('composer.uploadFailed')}
                  </span>
                  {onRetryFile != null && (
                    <button
                      type="button"
                      className={styles.chipRetry}
                      onClick={() => onRetryFile(chip.id)}
                    >
                      {t('composer.retry')}
                    </button>
                  )}
                </>
              )}
              {chip.state === 'idle' && (
                <span className={styles.chipSize}>
                  {formatFileSize(chip.file.size)}
                </span>
              )}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t('composer.remove', { name: chip.file.name })}
                onClick={() => onRemoveFile(chip.id)}
              >
                ×
              </button>
            </div>
          ))}
          <span className={styles.retentionHint}>
            {t('composer.attachmentRetention')}
          </span>
        </div>
      )}
      <div className={styles.composerRow}>
        <button
          type="button"
          className={styles.attachBtn}
          aria-label={t('composer.attachFiles')}
          disabled={disabled || attachedFiles.length >= MAX_FILE_COUNT}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('composer.studyingPlaceholder')}
          disabled={disabled}
          rows={1}
          aria-label={t('composer.messageInput')}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files != null && e.target.files.length > 0) {
              onAttach(Array.from(e.target.files));
            }
            e.target.value = '';
          }}
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
          onClick={onSubmit}
          disabled={!canSend}
          aria-label={t('composer.sendMessage')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function resolveOutgoingContent(
  rawContent: string,
  fileCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (rawContent.trim().length > 0) return rawContent;
  return t('composer.fileOnlyPrompt', { count: fileCount });
}

function ChatUpgradePanel({
  showReassurance,
}: {
  readonly showReassurance: boolean;
}) {
  const { t } = useTranslation('chat');

  useEffect(() => {
    track('paywall_shown', { surface: 'chat' });
  }, []);

  return (
    <section
      className={styles.upgradePanel}
      aria-label={t('paywall.heading')}
      data-testid="chat-upgrade-panel"
    >
      <h2 className={styles.upgradeHeading}>{t('paywall.heading')}</h2>
      <p className={styles.upgradeBody}>
        {t('paywall.body')}
        {showReassurance ? ` ${t('paywall.keepReading')}` : ''}
      </p>
      <Link
        to="/pricing?source=chat-paywall"
        className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
        onClick={() => track('paywall_upgrade_clicked', { surface: 'chat' })}
      >
        {t('paywall.seePlans')}
      </Link>
    </section>
  );
}

export default function ChatPanel({
  initialPrompt,
  cameFromUpload,
  onCardsGenerated,
  initialConversationId,
  initialMessages,
  initialTemplateSlug,
  initialTitle,
  onConversationCreated,
  onConversationNotFound,
  onTemplateChange,
}: ChatPanelProps) {
  const { t } = useTranslation('chat');
  const { data: userLocals, refetch: refetchUserLocals } = useUserLocals();
  const paying = userLocals == null || isPayingUser(userLocals.locals);
  const hasConsented = userLocals?.user?.chat_consent_at != null;
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [userDismissedConsent, setUserDismissedConsent] = useState(false);

  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [conversationTitle, setConversationTitle] = useState(
    initialTitle ?? ''
  );
  const [activeTemplate, setActiveTemplate] = useState<ChatCardTemplate>(
    initialTemplateSlug ?? DEFAULT_TEMPLATE
  );
  const [expandedUserMessages, setExpandedUserMessages] = useState<Set<number>>(
    new Set()
  );
  const [streamingText, setStreamingText] = useState('');
  const [inputValue, setInputValue] = useState(initialPrompt ?? '');

  useEffect(() => {
    if (initialPrompt != null && initialPrompt !== '') {
      setInputValue(initialPrompt);
    }
  }, [initialPrompt]);

  const [isLoading, setIsLoading] = useState(false);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);
  const [taggingIdx, setTaggingIdx] = useState<number | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [userScrolledAway, setUserScrolledAway] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSavedDraftRef = useRef<string>('');

  useEffect(() => {
    const el = messageListRef.current;
    if (el == null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 120) {
      bottomRef.current?.scrollIntoView({
        behavior: streamingText.length > 0 ? 'auto' : 'smooth',
      });
      setUserScrolledAway(false);
    }
  }, [messages, isLoading, streamingText]);

  useEffect(() => {
    const el = messageListRef.current;
    if (el == null) return;

    function handleScroll() {
      if (el == null) return;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      setUserScrolledAway(distanceFromBottom > 80);
    }

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (activeConversationId == null) return;
    if (inputValue === lastSavedDraftRef.current) return;
    const conversationId = activeConversationId;
    const draft = inputValue;
    const handle = setTimeout(() => {
      patch(`/api/chat/conversations/${conversationId}/draft`, {
        content: draft.length === 0 ? null : draft,
      })
        .then(() => {
          lastSavedDraftRef.current = draft;
        })
        .catch(() => {});
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [inputValue, activeConversationId]);

  const readyChips = chips.filter((c) => c.state === 'idle');
  const hasAssistantTurn = messages.some((m) => m.role === 'assistant');
  const canSend =
    (inputValue.trim().length > 0 || readyChips.length > 0) && !isLoading;

  async function addFiles(incoming: File[]) {
    setNetworkError(null);

    const disallowed = incoming.filter(
      (f) => !ALLOWED_ATTACHMENT_TYPES.has(f.type)
    );
    if (disallowed.length > 0) {
      if (disallowed.length === 1) {
        setNetworkError(
          t('errors.cantAttachOne', { name: disallowed[0].name })
        );
      } else {
        setNetworkError(
          t('errors.cantAttachMany', { count: disallowed.length })
        );
      }
      return;
    }

    const files = await Promise.all(incoming.map(compressImageForUpload));

    const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized != null) {
      setNetworkError(
        t('errors.oversize', {
          name: oversized.name,
          size: formatFileSize(oversized.size),
        })
      );
      return;
    }

    const currentTotal = chips.reduce((s, c) => s + c.file.size, 0);
    const newTotal = files.reduce((s, f) => s + f.size, currentTotal);
    if (newTotal > MAX_TOTAL_BYTES) {
      setNetworkError(
        t('errors.totalSize', { size: formatFileSize(newTotal) })
      );
      return;
    }

    const currentCount = chips.length;
    const allowedCount = Math.max(0, MAX_FILE_COUNT - currentCount);
    const toAdd = files.slice(0, allowedCount);

    setChips((prev) => [
      ...prev,
      ...toAdd.map<AttachmentChip>((f) => ({
        id: crypto.randomUUID(),
        file: f,
        state: 'idle',
        retryCount: 0,
      })),
    ]);
  }

  function removeChip(id: string) {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }

  function retryChip(id: string) {
    setChips((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, state: 'idle', retryCount: c.retryCount + 1 } : c
      )
    );
  }

  async function sendMessage(rawContent: string) {
    if (!rawContent.trim() && readyChips.length === 0) return;
    const content = resolveOutgoingContent(rawContent, readyChips.length, t);

    const userMessage: Message = { role: 'user', content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputValue('');
    setChips([]);
    setNetworkError(null);
    setIsLoading(true);
    setStreamingText('');
    setUserScrolledAway(false);

    const history = nextMessages
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    function requestMessage(
      historyPayload: { role: string; content: string }[]
    ): Promise<Response> {
      if (readyChips.length === 0) {
        return post('/api/chat/message', {
          content,
          history: historyPayload,
          conversationId: activeConversationId,
          templateSlug: activeTemplate,
        });
      }
      const formData = new FormData();
      formData.append('content', content);
      formData.append('history', JSON.stringify(historyPayload));
      formData.append('templateSlug', activeTemplate);
      if (activeConversationId != null) {
        formData.append('conversationId', String(activeConversationId));
      }
      for (const chip of readyChips) {
        formData.append('files', chip.file, chip.file.name);
      }
      return postMultipart('/api/chat/message', formData);
    }

    let response: Response;
    try {
      response = await requestMessage(history);
    } catch {
      setNetworkError(t('errors.send'));
      setIsLoading(false);
      return;
    }

    if (response.status === 402) {
      refetchUserLocals();
      setIsLoading(false);
      return;
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setNetworkError(data.error ?? t('errors.send'));
      setIsLoading(false);
      return;
    }

    if (response.body == null) {
      setNetworkError(t('errors.send'));
      setIsLoading(false);
      return;
    }

    const handleSseToken = (data: string) => {
      const text = JSON.parse(data) as string;
      setStreamingText((prev) => prev + text);
    };

    const handleSseDone = (data: string) => {
      const result = JSON.parse(data) as ApiDonePayload;
      const assistantMessage: Message = {
        role: 'assistant',
        content: result.content,
        contentBefore: result.contentBefore,
        contentAfter: result.contentAfter,
        cards: result.cards,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingText('');
      setActiveConversationId(result.conversationId);
      lastSavedDraftRef.current = '';
      const provisionalTitle =
        content.length > 60 ? `${content.slice(0, 60).trimEnd()}…` : content;
      setConversationTitle((prev) =>
        prev.trim().length > 0 ? prev : provisionalTitle
      );
      onConversationCreated?.(result.conversationId, provisionalTitle);
      adoptProducedTemplate(result.cards, result.conversationId);
      if (result.cards != null && result.cards.length > 0) {
        onCardsGenerated?.(result.cards);
      }
    };

    const handleSseError = (data: string) => {
      const err = JSON.parse(data) as ApiErrorPayload;
      if (err.type === 'conversation_not_found') {
        setNetworkError(t('errors.conversationGone'));
        setActiveConversationId(null);
        onConversationNotFound?.();
        return;
      }
      if (err.type === 'consent_required') {
        setShowConsentModal(true);
        return;
      }
      setNetworkError(t('errors.send'));
    };

    const dispatchSseEvent = (eventType: string, data: string) => {
      if (eventType === 'token') return handleSseToken(data);
      if (eventType === 'done') return handleSseDone(data);
      if (eventType === 'error') return handleSseError(data);
    };

    try {
      await consumeSseEvents(response.body, dispatchSseEvent);
    } catch {
      setNetworkError(t('errors.send'));
    } finally {
      setIsLoading(false);
      setStreamingText('');
    }
  }

  function handleSaveAsDeck(cards: ChatCard[], deckName: string) {
    const templateForCards = effectiveTemplateForCards(cards, activeTemplate);
    downloadDeck(cards, deckName, templateForCards).catch(() => {
      setNetworkError(t('errors.deckGenerate'));
    });
  }

  async function handleAddTags(messageIdx: number) {
    const target = messages[messageIdx];
    if (target == null || target.role !== 'assistant') return;
    if (target.cards == null || target.cards.length === 0) return;
    if (taggingIdx != null) return;
    const cardsToTag = target.cards;
    setTaggingIdx(messageIdx);
    setNetworkError(null);
    setSuccessMessage(null);
    try {
      const response = await post('/api/chat/tag-cards', {
        cards: cardsToTag.map((c) => ({ front: c.front, back: c.back })),
        conversationId: activeConversationId,
      });
      if (!response.ok) {
        setNetworkError(t('errors.addTags'));
        return;
      }
      const result = (await response.json()) as { tags: string[][] };
      if (!Array.isArray(result.tags)) {
        setNetworkError(t('errors.addTags'));
        return;
      }
      setMessages((prev) =>
        prev.map((m, i) => {
          if (i !== messageIdx || m.cards == null) return m;
          return {
            ...m,
            cards: m.cards.map((c, j) => ({
              ...c,
              tags: result.tags[j] ?? [],
            })),
          };
        })
      );
      const taggedCount = cardsToTag.length;
      setSuccessMessage(t('tags.success', { count: taggedCount }));
      window.setTimeout(() => setSuccessMessage(null), TAG_SUCCESS_DISMISS_MS);
    } catch {
      setNetworkError(t('errors.addTags'));
    } finally {
      setTaggingIdx(null);
    }
  }

  function adoptProducedTemplate(
    cards: ChatCard[] | undefined,
    conversationId: number
  ) {
    if (cards == null || cards.length === 0) return;
    const produced = effectiveTemplateForCards(cards, activeTemplate);
    if (produced === activeTemplate) return;
    setActiveTemplate(produced);
    onTemplateChange?.(produced);
    patch(`/api/chat/conversations/${conversationId}/template`, {
      templateSlug: produced,
    }).catch(() => {});
  }

  function handleTemplateChange(slug: ChatCardTemplate) {
    const lastAssistant = findLastAssistantIdx(messages);
    const lastTurnCards =
      lastAssistant === -1 ? [] : (messages[lastAssistant].cards ?? []);
    const cardsMatchSlug =
      effectiveTemplateForCards(lastTurnCards, activeTemplate) === slug;

    if (slug === activeTemplate) {
      if (cardsMatchSlug) return;
      if (lastAssistant !== -1 && !isLoading) {
        regenerateLastTurn(slug, lastAssistant);
      }
      return;
    }

    const reshapeOnly = isPureClientReshape(activeTemplate, slug);
    setActiveTemplate(slug);
    onTemplateChange?.(slug);
    if (activeConversationId != null) {
      patch(`/api/chat/conversations/${activeConversationId}/template`, {
        templateSlug: slug,
      }).catch(() => {});
    }
    if (reshapeOnly) return;
    if (lastAssistant !== -1 && !isLoading) {
      regenerateLastTurn(slug, lastAssistant);
    }
  }

  async function regenerateLastTurn(
    newSlug: ChatCardTemplate,
    targetIdx: number
  ) {
    if (activeConversationId == null) return;

    setRegeneratingIdx(targetIdx);
    setIsLoading(true);
    setNetworkError(null);
    setStreamingText('');
    setUserScrolledAway(false);

    let response: Response;
    try {
      response = await post(
        `/api/chat/conversations/${activeConversationId}/regenerate`,
        { templateSlug: newSlug }
      );
    } catch {
      setNetworkError(t('errors.rebuild'));
      setIsLoading(false);
      setRegeneratingIdx(null);
      return;
    }

    if (response.status === 402) {
      refetchUserLocals();
      setIsLoading(false);
      setRegeneratingIdx(null);
      return;
    }

    if (!response.ok || response.body == null) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setNetworkError(data.error ?? t('errors.rebuild'));
      setIsLoading(false);
      setRegeneratingIdx(null);
      return;
    }

    const handleRegenToken = (data: string) => {
      const text = JSON.parse(data) as string;
      setStreamingText((prev) => prev + text);
    };

    const handleRegenDone = (data: string) => {
      const result = JSON.parse(data) as ApiDonePayload;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === targetIdx
            ? {
                role: 'assistant',
                content: result.content,
                contentBefore: result.contentBefore,
                contentAfter: result.contentAfter,
                cards: result.cards,
              }
            : m
        )
      );
      setActiveConversationId(result.conversationId);
      adoptProducedTemplate(result.cards, result.conversationId);
      if (result.cards != null && result.cards.length > 0) {
        onCardsGenerated?.(result.cards);
      }
    };

    const handleRegenError = (data: string) => {
      const err = JSON.parse(data) as ApiErrorPayload;
      if (err.type === 'conversation_not_found') {
        setNetworkError(t('errors.conversationGone'));
        setActiveConversationId(null);
        onConversationNotFound?.();
        return;
      }
      if (err.type === 'consent_required') {
        setShowConsentModal(true);
        return;
      }
      if (err.type === 'attachments_not_replayable') {
        setNetworkError(t('errors.regenerateAttachments'));
        return;
      }
      setNetworkError(t('errors.rebuild'));
    };

    const dispatchRegenEvent = (eventType: string, data: string) => {
      if (eventType === 'token') return handleRegenToken(data);
      if (eventType === 'done') return handleRegenDone(data);
      if (eventType === 'error') return handleRegenError(data);
    };

    try {
      await consumeSseEvents(response.body, dispatchRegenEvent);
    } catch {
      setNetworkError(t('errors.rebuild'));
    } finally {
      setIsLoading(false);
      setRegeneratingIdx(null);
      setStreamingText('');
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        void addFiles(files);
      }
    },
    [chips] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const isCardStreaming =
    /(?:^|\n)```json/.test(streamingText) ||
    /(?:^|\n)\s*\[\s*\{/.test(streamingText);

  const hasMessages = messages.length > 0;
  const showEmptyState = !hasMessages && !isLoading;

  const composerProps: ComposerProps = {
    inputValue,
    onChange: setInputValue,
    onSubmit: () => {
      if (canSend) sendMessage(inputValue);
    },
    onAttach: addFiles,
    attachedFiles: chips,
    onRemoveFile: removeChip,
    onRetryFile: retryChip,
    disabled: isLoading,
    isDragging,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    textareaRef: composerTextareaRef,
  };

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUserScrolledAway(false);
  }

  const showScrollPill = userScrolledAway && isLoading;

  return (
    <>
      {(showConsentModal ||
        (!hasConsented &&
          userLocals != null &&
          isPayingUser(userLocals.locals) &&
          !userDismissedConsent)) && (
        <ConsentModal
          onAccept={async () => {
            await refetchUserLocals();
            setShowConsentModal(false);
          }}
          onDismiss={() => {
            setShowConsentModal(false);
            setUserDismissedConsent(true);
          }}
        />
      )}
      <div className={styles.container} data-hj-suppress>
        {showEmptyState ? (
          <div className={styles.emptyState}>
            {paying ? (
              <>
                <h2 className={styles.emptyHeading}>
                  {cameFromUpload
                    ? t('heading.withFile')
                    : t('heading.studying')}
                </h2>
                <div className={styles.emptyComposer}>
                  <div className={styles.composerTemplateRow}>
                    <TemplateSelector
                      value={activeTemplate}
                      onChange={handleTemplateChange}
                      disabled={isLoading}
                    />
                  </div>
                  <ComposerPill {...composerProps} />
                  {networkError != null && (
                    <p className={styles.networkError} role="alert">
                      {networkError}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <ChatUpgradePanel showReassurance={false} />
            )}
          </div>
        ) : (
          <>
            <div className={styles.messageList} ref={messageListRef}>
              <div className={styles.messageListInner} aria-live="polite">
                {(() => {
                  const lastCardsIdx = findLastAssistantWithCardsIdx(messages);
                  const lastAssistantIdx = findLastAssistantIdx(messages);
                  return messages.map((m, i) => {
                    if (m.role === 'user') {
                      return (
                        <UserMessage
                          key={i}
                          message={m}
                          expanded={expandedUserMessages.has(i)}
                          onToggleExpand={() => {
                            setExpandedUserMessages((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) {
                                next.delete(i);
                              } else {
                                next.add(i);
                              }
                              return next;
                            });
                          }}
                        />
                      );
                    }
                    const showTemplateSelector =
                      i === lastAssistantIdx || i === regeneratingIdx;
                    return (
                      <AssistantMessage
                        key={i}
                        message={m}
                        onSave={handleSaveAsDeck}
                        template={
                          showTemplateSelector ? activeTemplate : undefined
                        }
                        onTemplateChange={
                          showTemplateSelector
                            ? handleTemplateChange
                            : undefined
                        }
                        showSelectorWithoutCards={showTemplateSelector}
                        templateDisabled={isLoading}
                        isRegenerating={i === regeneratingIdx}
                        onAddTags={
                          i === lastCardsIdx
                            ? () => handleAddTags(i)
                            : undefined
                        }
                        isTagging={i === taggingIdx}
                        conversationTitle={conversationTitle}
                      />
                    );
                  });
                })()}
                {isLoading && regeneratingIdx == null && (
                  <StreamingMessage
                    streamingText={streamingText}
                    isCardStreaming={isCardStreaming}
                  />
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            {showScrollPill && (
              <div className={styles.scrollPillWrapper}>
                <button
                  type="button"
                  className={styles.scrollPill}
                  aria-label={t('composer.scrollToBottom')}
                  onClick={scrollToBottom}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </svg>
                </button>
              </div>
            )}

            <div className={styles.inputArea}>
              {paying ? (
                <>
                  {!hasAssistantTurn && (
                    <div className={styles.composerTemplateRow}>
                      <TemplateSelector
                        value={activeTemplate}
                        onChange={handleTemplateChange}
                        disabled={isLoading}
                      />
                    </div>
                  )}
                  <ComposerPill {...composerProps} />
                </>
              ) : (
                <ChatUpgradePanel showReassurance={messages.length > 0} />
              )}
              {networkError != null && (
                <p className={styles.networkError} role="alert">
                  {networkError}
                </p>
              )}
              {successMessage != null && (
                <p className={styles.successMessage} role="status">
                  {successMessage}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
