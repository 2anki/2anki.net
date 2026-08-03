import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDialog } from '../../lib/hooks/useDialog';
import sharedStyles from '../../styles/shared.module.css';
import styles from './ConversationsSidebar.module.css';

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
}

interface Props {
  conversations: ConversationSummary[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  onDeleteAll: () => void;
  isOpen: boolean;
  onClose: () => void;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled'));
}

function formatRelativeTime(iso: string, t: TFunction): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('sidebar.justNow');
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function ConversationsSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onDeleteAll,
  isOpen,
  onClose,
}: Props) {
  const { t } = useTranslation('chat');
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const deleteAllTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteAllCancelRef = useRef<HTMLButtonElement>(null);

  const closeConfirmDeleteAll = () => setConfirmDeleteAllOpen(false);
  const deleteAllDialogRef = useDialog(
    confirmDeleteAllOpen,
    closeConfirmDeleteAll
  );

  const confirmWasOpen = useRef(false);
  useEffect(() => {
    if (confirmDeleteAllOpen) {
      confirmWasOpen.current = true;
      deleteAllCancelRef.current?.focus();
    } else if (confirmWasOpen.current) {
      confirmWasOpen.current = false;
      deleteAllTriggerRef.current?.focus();
    }
  }, [confirmDeleteAllOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const aside = asideRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    focusableElements(aside ?? document.body)[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || aside == null) return;
      const focusables = focusableElements(aside);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (menuOpenFor == null) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current != null &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setMenuOpenFor(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenFor]);

  useEffect(() => {
    if (renamingId != null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  function startRename(id: number, currentTitle: string) {
    setRenamingId(id);
    setRenameDraft(currentTitle);
    setMenuOpenFor(null);
  }

  function commitRename(id: number) {
    const next = renameDraft.trim();
    if (next.length > 0) {
      onRename(id, next);
    }
    setRenamingId(null);
    setRenameDraft('');
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label={t('sidebar.closeConversations')}
          onClick={onClose}
        />
      )}
      <aside
        ref={asideRef}
        id="conversations-sidebar"
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
        aria-label={t('sidebar.conversations')}
      >
        <button type="button" className={styles.newChatBtn} onClick={onNew}>
          {t('sidebar.newChat')}
        </button>

        {conversations.length === 0 ? (
          <p className={styles.empty}>{t('sidebar.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {conversations.map((c) => {
              const isActive = c.id === activeId;
              const isRenaming = c.id === renamingId;
              return (
                <li
                  key={c.id}
                  className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className={styles.renameInput}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename(c.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      aria-label={t('sidebar.conversationTitle')}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.itemMain}
                      onClick={() => onSelect(c.id)}
                      title={c.title}
                    >
                      <span className={styles.itemTitle}>{c.title}</span>
                      <span className={styles.itemMeta}>
                        {formatRelativeTime(c.updatedAt, t)}
                      </span>
                    </button>
                  )}

                  {!isRenaming && (
                    <div
                      className={styles.menuWrapper}
                      ref={menuOpenFor === c.id ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        className={styles.menuTrigger}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenFor((prev) =>
                            prev === c.id ? null : c.id
                          );
                        }}
                        aria-label={t('sidebar.optionsFor', { title: c.title })}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenFor === c.id}
                      >
                        <span aria-hidden="true">⋯</span>
                      </button>

                      {menuOpenFor === c.id && (
                        <div className={styles.menu} role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.menuItem}
                            onClick={() => startRename(c.id, c.title)}
                          >
                            {t('sidebar.rename')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={`${styles.menuItem} ${styles.menuItemDanger}`}
                            onClick={() => {
                              setMenuOpenFor(null);
                              onDelete(c.id);
                            }}
                          >
                            {t('sidebar.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {conversations.length >= 2 && (
          <div className={styles.sidebarFooter}>
            <button
              ref={deleteAllTriggerRef}
              type="button"
              className={styles.deleteAllBtn}
              onClick={() => setConfirmDeleteAllOpen(true)}
            >
              {t('sidebar.deleteAllChats')}
            </button>
          </div>
        )}
      </aside>

      {confirmDeleteAllOpen && (
        <dialog
          ref={deleteAllDialogRef}
          className={sharedStyles.dialog}
          aria-labelledby="delete-all-chats-title"
          aria-describedby="delete-all-chats-body"
        >
          <div className={sharedStyles.modalCardNarrow}>
            <div className={sharedStyles.modalHeader}>
              <h4
                id="delete-all-chats-title"
                className={sharedStyles.modalHeaderTitle}
              >
                {t('deleteAll.title')}
              </h4>
              <button
                type="button"
                aria-label={t('deleteAll.close')}
                onClick={closeConfirmDeleteAll}
                className={sharedStyles.modalClose}
              >
                &times;
              </button>
            </div>
            <section
              id="delete-all-chats-body"
              className={sharedStyles.modalBody}
            >
              {t('deleteAll.body', { count: conversations.length })}
            </section>
            <div className={sharedStyles.modalFooter}>
              <button
                ref={deleteAllCancelRef}
                type="button"
                className={sharedStyles.btnSecondary}
                onClick={closeConfirmDeleteAll}
              >
                {t('deleteAll.cancel')}
              </button>
              <button
                type="button"
                className={sharedStyles.btnDanger}
                onClick={() => {
                  closeConfirmDeleteAll();
                  onDeleteAll();
                }}
              >
                {t('deleteAll.confirm')}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
