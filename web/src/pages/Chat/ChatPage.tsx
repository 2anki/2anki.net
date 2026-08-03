import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChatPanel, { type Message } from '../../components/ChatPanel/ChatPanel';
import { del, get, patch } from '../../lib/backend/api';
import { track } from '../../lib/analytics/track';
import styles from './ChatPage.module.css';
import ConversationsSidebar, {
  ConversationSummary,
} from './ConversationsSidebar';
import type { ChatCardTemplate } from '../../lib/chat/templates';
import { CHAT_TEMPLATE_OPTIONS } from '../../lib/chat/templates';

interface ApiConversationsResponse {
  conversations: ConversationSummary[];
}

interface ApiConversationDetailMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  cards?: { front: string; back: string }[];
  contentBefore?: string;
  contentAfter?: string;
}

interface ApiConversationDetailResponse {
  id: number;
  title: string;
  draft: string | null;
  templateSlug: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ApiConversationDetailMessage[];
}

interface PanelSeed {
  key: string;
  conversationId: number | null;
  messages: Message[];
  draft: string;
  templateSlug: ChatCardTemplate | null;
  title: string;
}

export default function ChatPage() {
  const { t } = useTranslation('chat');
  const [searchParams] = useSearchParams();
  const cameFromUpload = searchParams.get('from') === 'upload';
  const uploadFilename = searchParams.get('filename');
  const prefilledPrompt = cameFromUpload
    ? t('page.prefilledPrompt', {
        filename: uploadFilename ?? t('page.prefilledPromptFallback'),
      })
    : '';

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  const [panelSeed, setPanelSeed] = useState<PanelSeed>({
    key: 'new',
    conversationId: null,
    messages: [],
    draft: prefilledPrompt,
    templateSlug: null,
    title: '',
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    get('/api/chat/conversations', { redirect: false })
      .then((data: ApiConversationsResponse | undefined) => {
        if (data != null && Array.isArray(data.conversations)) {
          setConversations(data.conversations);
        }
      })
      .catch(() => {});
  }, []);

  function upsertConversation(id: number, title: string): void {
    setConversations((prev) => {
      const updatedAt = new Date().toISOString();
      const existing = prev.find((c) => c.id === id);
      if (existing != null) {
        return [
          { ...existing, title, updatedAt },
          ...prev.filter((c) => c.id !== id),
        ];
      }
      return [{ id, title, updatedAt }, ...prev];
    });
  }

  async function handleSelectConversation(id: number) {
    setSidebarOpen(false);
    if (id === activeConversationId) return;
    setLoadError(null);
    setActiveConversationId(id);
    try {
      const data = (await get(`/api/chat/conversations/${id}`, {
        redirect: false,
      })) as ApiConversationDetailResponse | undefined;
      if (data == null) return;
      const loaded: Message[] = data.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.cards == null ? {} : { cards: m.cards }),
        ...(m.contentBefore == null ? {} : { contentBefore: m.contentBefore }),
        ...(m.contentAfter == null ? {} : { contentAfter: m.contentAfter }),
      }));
      const validSlug = CHAT_TEMPLATE_OPTIONS.find(
        (o) => o.slug === data.templateSlug
      );
      setPanelSeed({
        key: `conv-${id}`,
        conversationId: id,
        messages: loaded,
        draft: data.draft ?? '',
        templateSlug:
          validSlug == null ? null : (data.templateSlug as ChatCardTemplate),
        title: data.title ?? '',
      });
    } catch {
      setLoadError(t('page.loadError'));
    }
  }

  function handleNewConversation() {
    setSidebarOpen(false);
    setActiveConversationId(null);
    setPanelSeed({
      key: `new-${Date.now()}`,
      conversationId: null,
      messages: [],
      draft: '',
      templateSlug: null,
      title: '',
    });
    setLoadError(null);
  }

  async function handleRenameConversation(id: number, title: string) {
    const previous = conversations;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
    try {
      const response = await patch(`/api/chat/conversations/${id}`, { title });
      if (!response.ok) {
        setConversations(previous);
        setLoadError(t('page.renameError'));
      }
    } catch {
      setConversations(previous);
      setLoadError(t('page.renameError'));
    }
  }

  async function handleDeleteConversation(id: number) {
    const previous = conversations;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeConversationId) {
      handleNewConversation();
    }
    try {
      const response = await del(`/api/chat/conversations/${id}`, {
        redirect: false,
      });
      if (response == null) return;
      if (!response.ok) {
        setConversations(previous);
        setLoadError(t('page.deleteError'));
      }
    } catch {
      setConversations(previous);
      setLoadError(t('page.deleteError'));
    }
  }

  async function handleDeleteAllConversations() {
    const previous = conversations;
    setConversations([]);
    handleNewConversation();
    try {
      const response = await del('/api/chat/conversations', {
        redirect: false,
      });
      if (response == null) return;
      if (!response.ok) {
        setConversations(previous);
        setLoadError(t('page.deleteAllError'));
        return;
      }
      track('chat_all_conversations_deleted', { count: previous.length });
    } catch {
      setConversations(previous);
      setLoadError(t('page.deleteAllError'));
    }
  }

  return (
    <div className={styles.layout} data-hj-suppress>
      <ConversationsSidebar
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onRename={handleRenameConversation}
        onDelete={handleDeleteConversation}
        onDeleteAll={handleDeleteAllConversations}
        isOpen={sidebarOpen}
        onClose={closeSidebar}
      />
      <div className={styles.container}>
        <div className={styles.mobileBar}>
          <button
            type="button"
            className={styles.mobileBarBtn}
            onClick={() => setSidebarOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sidebarOpen}
            aria-controls="conversations-sidebar"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            {t('page.pastChats')}
          </button>
          <button
            type="button"
            className={styles.mobileBarNew}
            onClick={handleNewConversation}
          >
            {t('page.newChat')}
          </button>
        </div>
        {loadError != null && (
          <p
            style={{
              color: 'var(--color-danger)',
              padding: '0 1.5rem',
              fontSize: 'var(--text-sm)',
            }}
          >
            {loadError}
          </p>
        )}
        <ChatPanel
          key={panelSeed.key}
          initialPrompt={panelSeed.draft}
          cameFromUpload={cameFromUpload}
          initialConversationId={panelSeed.conversationId}
          initialMessages={panelSeed.messages}
          initialTemplateSlug={panelSeed.templateSlug}
          initialTitle={panelSeed.title}
          onConversationCreated={(id, title) => {
            upsertConversation(id, title);
            setActiveConversationId(id);
          }}
          onConversationNotFound={() => {
            setActiveConversationId(null);
          }}
        />
      </div>
    </div>
  );
}
