import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateSelector } from '../../components/ChatPanel/TemplateSelector';
import DownloadIcon from '../../components/icons/DownloadIcon';
import {
  type ChatCardTemplate,
  effectiveTemplateForCards,
  templateSwitchLabel,
} from '../../lib/chat/templates';
import styles from './CardPreview.module.css';

interface ChatCard {
  front: string;
  back: string;
  tags?: string[];
  options?: string[];
  correctIndex?: number;
  rationale?: string;
}

function isMcqCard(card: ChatCard): boolean {
  return Array.isArray(card.options) && typeof card.correctIndex === 'number';
}

interface CardPreviewProps {
  cards: ChatCard[];
  onSave?: (deckName: string) => void;
  template?: ChatCardTemplate;
  onTemplateChange?: (slug: ChatCardTemplate) => void;
  templateDisabled?: boolean;
  isRegenerating?: boolean;
  onAddTags?: () => void;
  isTagging?: boolean;
  suggestedDeckName?: string;
}

const MAX_VISIBLE_TAGS = 3;
const CLOZE_PATTERN = /\{\{c\d+::/;

function expandForReversed(cards: ChatCard[]): ChatCard[] {
  const expanded: ChatCard[] = [];
  for (const card of cards) {
    expanded.push(card);
    if (card.back.trim().length > 0 && !CLOZE_PATTERN.test(card.front)) {
      expanded.push({ front: card.back, back: card.front, tags: card.tags });
    }
  }
  return expanded;
}

type SaveState = 'idle' | 'naming' | 'saved';

const VISIBLE_COUNT = 5;
const MAX_DECK_NAME_LENGTH = 120;
const FILENAME_FORBIDDEN = /[/\\:*?"<>|]/g;

function sanitizeFilename(name: string): string {
  return name
    .replace(FILENAME_FORBIDDEN, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_DECK_NAME_LENGTH);
}

function McqRow({ card }: { card: ChatCard }) {
  const { t } = useTranslation('chat');
  const options = card.options ?? [];
  const correctIndex = card.correctIndex ?? -1;
  return (
    <div className={styles.cardPreviewMcqRow}>
      <p className={styles.cardPreviewMcqStem}>{card.front}</p>
      <ol className={styles.cardPreviewMcqOptions}>
        {options.map((opt, i) => (
          <li
            key={i}
            className={
              i === correctIndex
                ? styles.cardPreviewMcqOptionCorrect
                : styles.cardPreviewMcqOption
            }
          >
            <span className={styles.cardPreviewMcqOptionLetter}>
              {String.fromCharCode(65 + i)}.
            </span>
            <span>{opt}</span>
            {i === correctIndex && (
              <span
                className={styles.cardPreviewMcqOptionCheck}
                aria-label={t('cardPreview.correctAnswer')}
              >
                ✓
              </span>
            )}
          </li>
        ))}
      </ol>
      {card.rationale != null && card.rationale.length > 0 && (
        <p className={styles.cardPreviewMcqRationale}>{card.rationale}</p>
      )}
    </div>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  const visible = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflow = tags.length - visible.length;
  return (
    <span className={styles.cardPreviewTagList}>
      {visible.map((tag) => (
        <span key={tag} className={styles.cardPreviewTagChip}>
          {tag}
        </span>
      ))}
      {overflow > 0 && (
        <span className={styles.cardPreviewTagOverflow}>+{overflow}</span>
      )}
    </span>
  );
}

export default function CardPreview({
  cards,
  onSave,
  template,
  onTemplateChange,
  templateDisabled,
  isRegenerating,
  onAddTags,
  isTagging,
  suggestedDeckName,
}: CardPreviewProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [deckNameDraft, setDeckNameDraft] = useState(
    () => suggestedDeckName ?? t('cardPreview.untitledDeck')
  );
  const [savedName, setSavedName] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saveState === 'naming' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [saveState]);

  const displayTemplate =
    template == null ? template : effectiveTemplateForCards(cards, template);
  const displayCards =
    template === 'basic-and-reversed' ? expandForReversed(cards) : cards;
  const allCardsAreMcq =
    displayCards.length > 0 && displayCards.every(isMcqCard);
  const visibleCards = expanded
    ? displayCards
    : displayCards.slice(0, VISIBLE_COUNT);
  const hasMore = displayCards.length > VISIBLE_COUNT;
  const hideBackColumn =
    displayTemplate === 'cloze' &&
    cards.length > 0 &&
    cards.every((c) => c.back.trim().length === 0);
  const hasTags =
    cards.some((c) => c.tags != null && c.tags.length > 0) ||
    isTagging === true;
  const showAddTagsButton =
    onAddTags != null && !isRegenerating && !isTagging && !hasTags;

  function openNaming() {
    setSaveState('naming');
    setShowHint(true);
  }

  function cancelNaming() {
    setSaveState(savedName == null ? 'idle' : 'saved');
  }

  function commitSave() {
    if (onSave == null) return;
    const sanitized = sanitizeFilename(deckNameDraft.trim());
    if (sanitized.length === 0) return;
    setSavedName(sanitized);
    setSaveState('saved');
    onSave(sanitized);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commitSave();
    } else if (e.key === 'Escape') {
      cancelNaming();
    }
  }

  const cardLabel = t('cardPreview.card', { count: displayCards.length });
  const switchLabel = template == null ? null : templateSwitchLabel(template);

  return (
    <div className={styles.cardPreview}>
      <div className={styles.cardPreviewHeader}>
        {displayCards.length > 0 && (
          <span className={styles.cardPreviewCount}>
            <span className={styles.cardPreviewCountNumber}>
              {displayCards.length}
            </span>{' '}
            {cardLabel}
          </span>
        )}

        {displayTemplate != null && onTemplateChange != null && (
          <TemplateSelector
            value={displayTemplate}
            onChange={onTemplateChange}
            disabled={templateDisabled === true || isRegenerating === true}
          />
        )}

        {showAddTagsButton && (
          <button
            type="button"
            className={styles.cardPreviewAddTags}
            onClick={onAddTags}
          >
            {t('cardPreview.addTags')}
          </button>
        )}

        {saveState === 'idle' && !isRegenerating && onSave != null && (
          <button
            type="button"
            className={styles.cardPreviewSave}
            aria-label={t('cardPreview.downloadDeck')}
            onClick={openNaming}
          >
            <DownloadIcon width={13} height={13} />
            {t('cardPreview.downloadDeck')}
          </button>
        )}

        {saveState === 'naming' && (
          <div className={styles.renameRow}>
            <input
              ref={inputRef}
              type="text"
              className={styles.renameInput}
              value={deckNameDraft}
              onChange={(e) => setDeckNameDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_DECK_NAME_LENGTH}
              placeholder={t('cardPreview.nameThisDeck')}
              aria-label={t('cardPreview.deckName')}
            />
            <button
              type="button"
              className={styles.renameSave}
              onClick={commitSave}
              disabled={deckNameDraft.trim().length === 0}
            >
              {t('cardPreview.save')}
            </button>
            <button
              type="button"
              className={styles.renameCancel}
              onClick={cancelNaming}
            >
              {t('cardPreview.cancel')}
            </button>
            {showHint && (
              <p className={styles.renameHint}>
                {t('cardPreview.renameHint', {
                  count: cards.length,
                  filename:
                    sanitizeFilename(deckNameDraft.trim()) ||
                    t('cardPreview.untitledDeck'),
                })}
              </p>
            )}
          </div>
        )}

        {saveState === 'saved' && savedName != null && (
          <div className={styles.savedLine}>
            <span className={styles.savedFile}>
              {t('cardPreview.savedAs', { name: savedName })}
            </span>
            <button
              type="button"
              className={styles.savedAgainBtn}
              onClick={openNaming}
            >
              {t('cardPreview.saveAgain')}
            </button>
          </div>
        )}
      </div>

      {displayCards.length > 0 && !allCardsAreMcq && (
        <div
          className={`${styles.cardPreviewColumnLabels} ${hideBackColumn && !hasTags ? styles.cardPreviewColumnLabelsSingle : ''} ${!hideBackColumn && hasTags ? styles.cardPreviewColumnLabelsThree : ''}`}
        >
          <span>{t('cardPreview.front')}</span>
          {!hideBackColumn && <span>{t('cardPreview.back')}</span>}
          {hasTags && <span>{t('cardPreview.tags')}</span>}
        </div>
      )}

      {isRegenerating === true && switchLabel != null && (
        <p
          className={styles.cardPreviewSwitchHint}
          role="status"
          aria-label={switchLabel}
        >
          {switchLabel}
        </p>
      )}
      {displayCards.length > 0 && (
        <div
          className={`${styles.cardPreviewList} ${isRegenerating === true ? styles.cardPreviewListDimmed : ''}`}
          aria-busy={isRegenerating === true}
        >
          {visibleCards.map((card, i) =>
            isMcqCard(card) ? (
              <McqRow key={i} card={card} />
            ) : (
              <div
                key={i}
                className={`${styles.cardPreviewRow} ${hideBackColumn && !hasTags ? styles.cardPreviewRowSingle : ''} ${!hideBackColumn && hasTags ? styles.cardPreviewRowThree : ''}`}
              >
                <div className={styles.cardPreviewFront}>
                  {(!hideBackColumn || hasTags) && (
                    <span className={styles.cardPreviewMobileLabel}>
                      {t('cardPreview.front')}
                    </span>
                  )}
                  {card.front}
                </div>
                {!hideBackColumn && (
                  <div className={styles.cardPreviewBack}>
                    <span className={styles.cardPreviewMobileLabel}>
                      {t('cardPreview.back')}
                    </span>
                    {card.back}
                  </div>
                )}
                {hasTags && (
                  <div className={styles.cardPreviewTags}>
                    <span className={styles.cardPreviewMobileLabel}>
                      {t('cardPreview.tags')}
                    </span>
                    {isTagging ? (
                      <span
                        className={styles.cardPreviewTagSkeleton}
                        role="status"
                        aria-label={t('cardPreview.addingTags')}
                      />
                    ) : (
                      <TagChips tags={card.tags ?? []} />
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {hasMore && (
        <button
          type="button"
          className={styles.cardPreviewExpandBtn}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t('cardPreview.showFewer')
            : t('cardPreview.showAll', { count: displayCards.length })}
        </button>
      )}
    </div>
  );
}
