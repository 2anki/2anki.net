import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  CardOptionsForm,
  CardOptionsFormHandle,
} from '../../components/CardOptionsForm/CardOptionsForm';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { FieldHint } from '../../components/FieldHint';
import Switch from '../../components/input/Switch';
import TemplateSelect from '../../components/TemplateSelect';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import sharedStyles from '../../styles/shared.module.css';
import RuleDefinition from '../SearchPage/components/RuleDefinition';
import { NewRule } from '../SearchPage/types';
import styles from './RulesPage.module.css';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

const flashCardOptions = [
  'paragraph',
  'callout',
  'quote',
  'code',
  'toggle',
  'to_do',
  'bulleted_list_item',
  'numbered_list_item',
  'column_list',
  'table',
  'heading_1',
  'heading_2',
  'heading_3',
];

const newFlashCardOptions = ['table'];
const tagOptions = ['heading', 'strikethrough'];
const subDeckOptions = [
  'child_page',
  'child_database',
  'toggle',
  'heading_1',
  'heading_2',
  'heading_3',
];
const deckOptions = ['page', 'database'];
const advancedDeckOptions = [
  'toggle',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'column_list',
  'child_database',
];
const advancedDeckLabelKeys: Record<string, string> = {
  toggle: 'rules.labelToggle',
  heading_1: 'rules.labelHeading1',
  heading_2: 'rules.labelHeading2',
  heading_3: 'rules.labelHeading3',
  bulleted_list_item: 'rules.labelBulletedList',
  numbered_list_item: 'rules.labelNumberedList',
  quote: 'rules.labelQuote',
  column_list: 'rules.labelColumns',
  child_database: 'rules.labelDatabaseInPage',
};
const allowedDeckTypes = new Set([...deckOptions, ...advancedDeckOptions]);

const defaultRules: NewRule = {
  id: 0,
  owner: 0,
  object_id: '',
  flashcard_is: ['toggle'],
  sub_deck_is: ['child_page'],
  tags_is: 'strikethrough',
  deck_is: ['page', 'database'],
  email_notification: false,
};

type RuleListKey = 'flashcard_is' | 'sub_deck_is' | 'deck_is';

function loadDeckSelection(raw: string | null | undefined): string[] {
  if (raw == null || raw.length === 0) {
    return [...deckOptions];
  }
  const allowed = raw.split(',').filter((v) => allowedDeckTypes.has(v));
  return allowed.length > 0 ? allowed : [...deckOptions];
}

function hasAdvancedDeckType(deckTypes: string[]): boolean {
  return deckTypes.some((type) => advancedDeckOptions.includes(type));
}

const byLocale = (a: string, b: string) => a.localeCompare(b);

function snapshot(rules: NewRule, tags: string, email: boolean) {
  return JSON.stringify({
    flashcard_is: [...rules.flashcard_is].sort(byLocale),
    sub_deck_is: [...rules.sub_deck_is].sort(byLocale),
    deck_is: [...rules.deck_is].sort(byLocale),
    tags_is: tags,
    email_notification: email,
  });
}

export default function RulesPage({ setErrorMessage }: Readonly<Props>) {
  const { t } = useTranslation('tools');
  const { id = '' } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const titleParam = params.get('title');
  const headingTitle = titleParam
    ? t('rules.headingWithTitle', { title: titleParam })
    : t('rules.heading');
  const type = params.get('type');
  const advancedDeckLabels: Record<string, string> = Object.fromEntries(
    Object.entries(advancedDeckLabelKeys).map(([key, value]) => [key, t(value)])
  );
  const returnTo = params.get('returnTo') ?? '/notion';

  const [rules, setRules] = useState<NewRule>(defaultRules);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [tags, setTags] = useState(defaultRules.tags_is);
  const [sendEmail, setSendEmail] = useState(defaultRules.email_notification);
  const [favorite, setFavorite] = useState<boolean>(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const cardOptionsRef = useRef<CardOptionsFormHandle>(null);

  const currentSnapshot = useMemo(
    () => snapshot(rules, tags, sendEmail),
    [rules, tags, sendEmail]
  );
  const isRulesDirty =
    initialSnapshot !== '' && currentSnapshot !== initialSnapshot;

  const hasUnsavedChanges = () =>
    isRulesDirty || !!cardOptionsRef.current?.isDirty();

  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadFailed(false);
    setInitialSnapshot('');
    setRules(defaultRules);
    setSendEmail(defaultRules.email_notification);
    setTags(defaultRules.tags_is);
    setFavorite(false);

    Promise.all([get2ankiApi().getRules(id), get2ankiApi().getFavorites()])
      .then(([rule, favorites]) => {
        if (cancelled) return;
        const loaded: NewRule = rule
          ? {
              ...rule,
              flashcard_is: rule.flashcard_is.split(',').filter(Boolean),
              sub_deck_is: rule.sub_deck_is
                .split(',')
                .filter((v: string) => subDeckOptions.includes(v)),
              deck_is: loadDeckSelection(rule.deck_is),
            }
          : defaultRules;
        setRules(loaded);
        setSendEmail(loaded.email_notification);
        setTags(loaded.tags_is);
        setAdvancedOpen(hasAdvancedDeckType(loaded.deck_is));
        setFavorite(favorites.some((f) => f.id === id));
        setInitialSnapshot(
          snapshot(loaded, loaded.tags_is, loaded.email_notification)
        );
        setIsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error);
        setLoadFailed(true);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const resetAll = async () => {
    if (isResetting) return;
    setIsResetting(true);
    try {
      await Promise.all([
        get2ankiApi().deleteRules(id),
        get2ankiApi().deleteSettings(id),
      ]);
      setRules(defaultRules);
      setTags(defaultRules.tags_is);
      setSendEmail(defaultRules.email_notification);
      setAdvancedOpen(false);
      setInitialSnapshot(
        snapshot(
          defaultRules,
          defaultRules.tags_is,
          defaultRules.email_notification
        )
      );
      await cardOptionsRef.current?.reset();
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setIsResetting(false);
    }
  };

  const goBack = () => navigate(returnTo);

  const confirmDiscard = () => {
    if (!hasUnsavedChanges()) return true;
    return globalThis.confirm(t('rules.unsavedConfirm'));
  };

  const handleBack = () => {
    if (confirmDiscard()) goBack();
  };

  const saveAll = async (
    event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement, MouseEvent>
  ) => {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    const deckSelection =
      rules.deck_is.length === 0 ? [...deckOptions] : rules.deck_is;

    try {
      await get2ankiApi().saveRules(
        id,
        rules.flashcard_is,
        deckSelection,
        rules.sub_deck_is,
        tags,
        sendEmail
      );
      const cardOptionsOk = await cardOptionsRef.current?.save();
      if (cardOptionsOk === false) {
        setIsSaving(false);
        return;
      }
      goBack();
    } catch (error) {
      setErrorMessage(error);
      setIsSaving(false);
    }
  };

  const toggleSelection = (key: RuleListKey, value: string) => {
    setRules((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((f) => f !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const toggleFavorite = async () => {
    if (isTogglingFavorite) return;
    setIsTogglingFavorite(true);
    const next = !favorite;
    try {
      const ok = favorite
        ? await get2ankiApi().deleteFavorite(id)
        : await get2ankiApi().addFavorite(id, type);
      if (!ok) {
        throw new Error(t('rules.failedFavorite'));
      }
      setFavorite(next);
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  let backLabel = t('rules.back');
  if (returnTo === '/notion') backLabel = t('rules.backToNotion');
  else if (returnTo.startsWith('/preview/'))
    backLabel = t('rules.backToPreview');

  return (
    <>
      <Helmet>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className={styles.pageShell}>
        <div className={sharedStyles.page}>
          <header className={sharedStyles.pageHeader}>
            <button
              type="button"
              onClick={handleBack}
              className={styles.backLink}
            >
              {backLabel}
            </button>
            <div className={styles.headerRow}>
              <div className={styles.headerText}>
                <h1 className={sharedStyles.title} data-hj-suppress>
                  {headingTitle}
                </h1>
                <p className={sharedStyles.subtitle}>{t('rules.subtitle')}</p>
              </div>
              <button
                type="button"
                className={`${sharedStyles.btnIcon} ${favorite ? styles.favoriteActive : ''}`}
                onClick={toggleFavorite}
                disabled={isTogglingFavorite || isLoading}
                aria-pressed={favorite}
                aria-label={
                  favorite
                    ? t('rules.removeFromFavorites')
                    : t('rules.favoriteThisPage')
                }
                title={
                  favorite
                    ? t('rules.removeFromFavorites')
                    : t('rules.favoriteThisPage')
                }
              >
                <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
              </button>
            </div>
          </header>

          {isLoading && (
            <div className={`${styles.optionGroup} ${styles.loadingCard}`}>
              <div className={sharedStyles.spinner} />
            </div>
          )}
          {!isLoading && loadFailed && (
            <div className={`${styles.optionGroup} ${styles.loadingCard}`}>
              <p>{t('rules.loadError')}</p>
            </div>
          )}
          {!isLoading && !loadFailed && (
            <>
              <section className={styles.optionGroup}>
                <div className={styles.groupHeader}>
                  <h2 className={styles.groupHeading}>
                    {t('rules.decksAndSubdecks')}
                  </h2>
                  <FieldHint text={t('rules.decksHint')} />
                </div>
                <p className={styles.groupHint}>{t('rules.decksIntro')}</p>

                <div className={styles.section}>
                  <div className={styles.labelRow}>
                    <span className={styles.sectionLabel}>
                      {t('rules.deckBoundaries')}
                    </span>
                    <FieldHint text={t('rules.deckBoundariesHint')} />
                  </div>
                  <RuleDefinition
                    value={rules.deck_is}
                    options={deckOptions}
                    onSelected={(fco) => toggleSelection('deck_is', fco)}
                  />
                </div>

                <details
                  className={styles.advanced}
                  open={advancedOpen}
                  onToggle={(event) =>
                    setAdvancedOpen(event.currentTarget.open)
                  }
                >
                  <summary className={styles.advancedSummary}>
                    <span className={styles.advancedCaret} aria-hidden="true">
                      ›
                    </span>
                    {t('rules.advancedDeckTypes')}
                    <FieldHint text={t('rules.advancedHint')} />
                  </summary>
                  <div className={styles.advancedBody}>
                    <p className={styles.advancedHint}>
                      {t('rules.advancedBody')}
                    </p>
                    <RuleDefinition
                      value={rules.deck_is}
                      options={advancedDeckOptions}
                      labels={advancedDeckLabels}
                      onSelected={(fco) => toggleSelection('deck_is', fco)}
                    />
                    {hasAdvancedDeckType(rules.deck_is) && (
                      <p className={styles.advancedWarning}>
                        {t('rules.advancedWarning')}
                      </p>
                    )}
                  </div>
                </details>

                <div className={styles.section}>
                  <div className={styles.labelRow}>
                    <span className={styles.sectionLabel}>
                      {t('rules.subDecks')}
                    </span>
                    <FieldHint text={t('rules.subDecksHint')} />
                  </div>
                  <RuleDefinition
                    value={rules.sub_deck_is}
                    options={subDeckOptions}
                    onSelected={(fco) => toggleSelection('sub_deck_is', fco)}
                  />
                </div>
              </section>

              <section className={styles.optionGroup}>
                <div className={styles.groupHeader}>
                  <h2 className={styles.groupHeading}>
                    {t('rules.flashcards')}
                  </h2>
                  <FieldHint text={t('rules.flashcardsHint')} />
                </div>
                <RuleDefinition
                  value={rules.flashcard_is}
                  options={flashCardOptions}
                  newOptions={newFlashCardOptions}
                  onSelected={(fco) => toggleSelection('flashcard_is', fco)}
                />
              </section>

              <section className={styles.optionGroup}>
                <div className={styles.groupHeader}>
                  <h2 className={styles.groupHeading}>
                    {t('rules.tagsAndNotifications')}
                  </h2>
                  <FieldHint text={t('rules.tagsHint')} />
                </div>

                <div className={styles.section}>
                  <div className={styles.labelRow}>
                    <label
                      htmlFor="tags-format"
                      className={styles.sectionLabel}
                    >
                      {t('rules.tagFormat')}
                    </label>
                    <FieldHint text={t('rules.tagFormatHint')} />
                  </div>
                  <TemplateSelect
                    data-hj-suppress
                    pickedTemplate={(name: string) => setTags(name)}
                    values={tagOptions.map((fco) => ({
                      label:
                        fco === 'heading'
                          ? t('rules.tagsAreHeading')
                          : t('rules.tagsAreStrikethrough'),
                      value: fco,
                    }))}
                    name="tags-format"
                    value={tags}
                  />
                </div>

                <div className={styles.switchRow}>
                  <Switch
                    id="email-notification"
                    title={t('rules.emailWhenReady')}
                    checked={sendEmail}
                    onSwitched={() => setSendEmail((prev) => !prev)}
                  />
                  <FieldHint text={t('rules.emailHint')} />
                </div>
              </section>

              <div className={styles.formHeader}>
                <hr className={styles.divider} />
                <h2 className={styles.formHeading}>{t('rules.cardOptions')}</h2>
                <p className={sharedStyles.smallDescription}>
                  {t('rules.cardOptionsDescPrefix')}{' '}
                  <Link to="/card-options">{t('rules.editYourDefaults')}</Link>
                  {t('rules.cardOptionsDescSuffix')}
                </p>
              </div>
              <CardOptionsForm
                ref={cardOptionsRef}
                pageId={id}
                pageTitle={titleParam}
                setError={setErrorMessage}
                hideActions
              />

              <div className={styles.saveBar}>
                <button
                  type="button"
                  className={`${sharedStyles.btnSecondary} ${styles.actionButton}`}
                  onClick={resetAll}
                  disabled={isSaving || isResetting}
                >
                  {isResetting
                    ? t('rules.resetting')
                    : t('rules.resetToDefaults')}
                </button>
                <button
                  type="button"
                  className={`${sharedStyles.btnSecondary} ${styles.actionButton}`}
                  onClick={handleBack}
                  disabled={isSaving}
                >
                  {t('rules.cancel')}
                </button>
                <button
                  type="button"
                  className={`${sharedStyles.btnPrimary} ${styles.actionButton}`}
                  onClick={saveAll}
                  disabled={isSaving}
                >
                  {isSaving ? t('rules.saving') : t('rules.saveChanges')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
