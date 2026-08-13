import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  AIChatMessage,
  AiQuotaExceededError,
  AnkiNoteType,
  NoteTypeStarter,
  aiGenerateNoteType,
  aiModifyNoteType,
  downloadNoteTypeApkg,
  getDefaultNoteTypes,
  getOfficialNoteTypes,
  getUserTemplates,
  saveUserTemplate,
} from '../../lib/backend/templates';
import sharedStyles from '../../styles/shared.module.css';
import editorStyles from './EditorPage.module.css';
import galleryStyles from './TemplatesPage.module.css';
import { CodeEditor } from './components/CodeEditor/CodeEditor';
import {
  BaseType,
  buildEmptyNoteType,
  duplicateStarter,
} from './lib/buildNoteType';
import {
  addField as addFieldOp,
  removeField as removeFieldOp,
  renameField as renameFieldOp,
  setPreviewValue as setPreviewValueOp,
} from './lib/editFields';
import { buildPreviewDocument } from './renderNoteTypePreview';

type Pane = 'front' | 'back' | 'css';

function safeFilename(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'note-type';
  return trimmed.replace(/[^A-Za-z0-9\-_ ]/g, '_');
}

function fingerprintStarter(s: NoteTypeStarter): string {
  const nt = s.noteType;
  return JSON.stringify({
    name: s.name,
    description: s.description,
    baseType: s.baseType,
    css: nt.css,
    type: nt.type,
    flds: nt.flds.map((f) => ({ name: f.name, ord: f.ord })),
    tmpls: nt.tmpls.map((t) => ({
      name: t.name,
      ord: t.ord,
      qfmt: t.qfmt,
      afmt: t.afmt,
    })),
  });
}

function getSaveLabel(
  saving: boolean,
  shouldFork: boolean,
  t: TFunction<'tools'>
): string {
  if (saving) return t('templates.saving');
  return shouldFork ? t('templates.saveAsCopy') : t('templates.save');
}

interface PresetPickerProps {
  loading: boolean;
  presets: NoteTypeStarter[];
  onPick: (pick: NoteTypeStarter | BaseType) => void;
}

function PresetPicker({
  loading,
  presets,
  onPick,
}: Readonly<PresetPickerProps>) {
  const { t } = useTranslation('tools');
  return (
    <div className={sharedStyles.page}>
      <Helmet>
        <title>{t('templates.newPageTitle')} — 2anki</title>
      </Helmet>
      <header className={sharedStyles.pageHeader}>
        <h1 className={sharedStyles.title}>{t('templates.startNew')}</h1>
        <p className={sharedStyles.subtitle}>
          {t('templates.startNewSubtitle')}
        </p>
      </header>

      <AIGenerateSection onGenerated={onPick} />

      <section
        className={editorStyles.presetSection}
        aria-labelledby="preset-starter-heading"
      >
        <h2 id="preset-starter-heading" className={editorStyles.presetHeading}>
          {t('templates.fromStarter')}
        </h2>
        {loading && (
          <p className={editorStyles.presetEmpty}>
            {t('templates.loadingStarters')}
          </p>
        )}
        {!loading && presets.length === 0 && (
          <p className={editorStyles.presetEmpty}>
            {t('templates.noStarters')}
          </p>
        )}
        {presets.length > 0 && (
          <div className={editorStyles.presetGrid}>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={editorStyles.presetCard}
                onClick={() => onPick(preset)}
              >
                <span className={editorStyles.presetName}>{preset.name}</span>
                <span className={editorStyles.presetDescription}>
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section
        className={editorStyles.presetSection}
        aria-labelledby="preset-blank-heading"
      >
        <h2 id="preset-blank-heading" className={editorStyles.presetHeading}>
          {t('templates.fromScratch')}
        </h2>
        <div className={editorStyles.presetGrid}>
          <button
            type="button"
            className={editorStyles.presetCard}
            onClick={() => onPick('basic')}
          >
            <span className={editorStyles.presetName}>
              {t('templates.blankBasic')}
            </span>
            <span className={editorStyles.presetDescription}>
              {t('templates.blankBasicDesc')}
            </span>
          </button>
          <button
            type="button"
            className={editorStyles.presetCard}
            onClick={() => onPick('cloze')}
          >
            <span className={editorStyles.presetName}>
              {t('templates.blankCloze')}
            </span>
            <span className={editorStyles.presetDescription}>
              {t('templates.blankClozeDesc')}
            </span>
          </button>
        </div>
      </section>

      <Link to="/templates" className={editorStyles.presetBack}>
        {t('templates.backToNoteTypesArrow')}
      </Link>
    </div>
  );
}

interface AIGenerateSectionProps {
  onGenerated: (pick: NoteTypeStarter) => void;
}

function AIGenerateSection({ onGenerated }: Readonly<AIGenerateSectionProps>) {
  const { t } = useTranslation('tools');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaUpgradeUrl, setQuotaUpgradeUrl] = useState<string | null>(null);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    setQuotaUpgradeUrl(null);
    try {
      const result = await aiGenerateNoteType(prompt);
      onGenerated(result.starter);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t('templates.couldNotGenerateShort')
      );
      if (err instanceof AiQuotaExceededError) {
        setQuotaUpgradeUrl(err.upgradeUrl);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={editorStyles.presetSection}
      aria-labelledby="preset-ai-heading"
    >
      <h2 id="preset-ai-heading" className={editorStyles.presetHeading}>
        {t('templates.describeNoteType')}
      </h2>
      <p className={editorStyles.presetSubtitle}>
        {t('templates.describeSubtitle')}
      </p>
      <div className={editorStyles.aiPromptRow}>
        <input
          className={editorStyles.aiPromptInput}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('templates.aiPromptPlaceholder')}
          aria-label={t('templates.aiPromptAria')}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy && prompt.trim().length > 0) {
              onSubmit();
            }
          }}
        />
        <button
          type="button"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          onClick={onSubmit}
          disabled={busy || prompt.trim().length === 0}
        >
          {busy ? t('templates.drafting') : t('templates.draftIt')}
        </button>
      </div>
      {error && (
        <p className={editorStyles.aiError} role="alert">
          {error}
          {quotaUpgradeUrl && (
            <>
              {' '}
              <Link to={quotaUpgradeUrl} className={editorStyles.aiUpgradeLink}>
                {t('templates.seePricing')}
              </Link>
            </>
          )}
        </p>
      )}
    </section>
  );
}

async function findStarter(id: string): Promise<NoteTypeStarter | null> {
  const [defaults, official, user] = await Promise.all([
    getDefaultNoteTypes().catch(() => []),
    getOfficialNoteTypes().catch(() => []),
    getUserTemplates().catch(() => ({ templates: [], hiddenIds: [] })),
  ]);
  const all = [...user.templates, ...official, ...defaults];
  return all.find((s) => s.id === id) ?? null;
}

interface EditorBodyProps {
  initialStarter: NoteTypeStarter;
  shouldFork: boolean;
}

function EditorBody({ initialStarter, shouldFork }: Readonly<EditorBodyProps>) {
  const { t } = useTranslation('tools');
  const navigate = useNavigate();
  const [draft, setDraft] = useState<NoteTypeStarter>(initialStarter);
  const [pane, setPane] = useState<Pane>('front');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<AIChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatUpgradeUrl, setChatUpgradeUrl] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<{
    instruction: string;
    history: AIChatMessage[];
  } | null>(null);

  useEffect(() => {
    setDraft(initialStarter);
  }, [initialStarter]);

  const previewSide: 'front' | 'back' = pane === 'back' ? 'back' : 'front';
  const previewDoc = useMemo(
    () => buildPreviewDocument(draft.noteType, draft.previewData, previewSide),
    [draft, previewSide]
  );

  const updateNoteType = useCallback(
    (updater: (n: AnkiNoteType) => AnkiNoteType) => {
      setDraft((current) => ({
        ...current,
        noteType: updater(current.noteType),
      }));
    },
    []
  );

  const setQfmt = (value: string) => {
    updateNoteType((n) => ({
      ...n,
      tmpls: n.tmpls.map((t, i) => (i === 0 ? { ...t, qfmt: value } : t)),
    }));
  };
  const setAfmt = (value: string) => {
    updateNoteType((n) => ({
      ...n,
      tmpls: n.tmpls.map((t, i) => (i === 0 ? { ...t, afmt: value } : t)),
    }));
  };
  const setCss = (value: string) => {
    updateNoteType((n) => ({ ...n, css: value }));
  };

  const handleNameChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      name: value,
      noteType: { ...current.noteType, name: value },
    }));
  };

  const handleDescriptionChange = (value: string) => {
    setDraft((current) => ({ ...current, description: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const starterToSave = shouldFork
        ? duplicateStarter(draft, initialStarter.name)
        : draft;
      await saveUserTemplate(starterToSave);
      setSavedAt(Date.now());
      if (starterToSave.id !== draft.id) {
        navigate(`/templates/edit/${encodeURIComponent(starterToSave.id)}`, {
          replace: true,
        });
      }
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error ? error.message : t('templates.couldNotSave')
      );
    } finally {
      setSaving(false);
    }
  };

  const performModify = async (
    instruction: string,
    historyBeforeUser: AIChatMessage[]
  ) => {
    setChatBusy(true);
    setChatError(null);
    setChatUpgradeUrl(null);
    setLastAttempt({ instruction, history: historyBeforeUser });
    const before = fingerprintStarter(draft);
    try {
      const result = await aiModifyNoteType(
        draft,
        instruction,
        historyBeforeUser
      );
      const after = fingerprintStarter(result.starter);
      setDraft((current) => ({
        ...current,
        name: result.starter.name,
        description: result.starter.description,
        baseType: result.starter.baseType,
        noteType: result.starter.noteType,
        previewData: result.starter.previewData,
      }));
      const reply =
        before === after
          ? t('templates.nothingChanged')
          : result.reply || t('templates.updated');
      setChatHistory([
        ...historyBeforeUser,
        { role: 'user', content: instruction },
        { role: 'assistant', content: reply },
      ]);
      setLastAttempt(null);
    } catch (error: unknown) {
      setChatError(
        error instanceof Error ? error.message : t('templates.claudeNoResponse')
      );
      if (error instanceof AiQuotaExceededError) {
        setChatUpgradeUrl(error.upgradeUrl);
      }
    } finally {
      setChatBusy(false);
    }
  };

  const handleSendChat = async () => {
    const instruction = chatInput.trim();
    if (instruction.length === 0 || chatBusy) return;
    const historyBeforeUser = chatHistory;
    setChatInput('');
    setChatHistory([
      ...historyBeforeUser,
      { role: 'user', content: instruction },
    ]);
    await performModify(instruction, historyBeforeUser);
  };

  const handleRetry = async () => {
    if (!lastAttempt || chatBusy) return;
    await performModify(lastAttempt.instruction, lastAttempt.history);
  };

  const handleDownload = async () => {
    try {
      const blob = await downloadNoteTypeApkg(
        draft.noteType,
        draft.previewData
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(draft.name)}.apkg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error ? error.message : t('templates.couldNotGenerate')
      );
    }
  };

  const template = draft.noteType.tmpls[0];
  const activeValueByPane: Record<Pane, string> = {
    front: template.qfmt,
    back: template.afmt,
    css: draft.noteType.css,
  };
  const setActiveValueByPane: Record<Pane, (value: string) => void> = {
    front: setQfmt,
    back: setAfmt,
    css: setCss,
  };
  const activeValue = activeValueByPane[pane];
  const setActiveValue = setActiveValueByPane[pane];
  const activeLanguage: 'html' | 'css' = pane === 'css' ? 'css' : 'html';
  const sideLabel =
    previewSide === 'back' ? t('templates.sideBack') : t('templates.sideFront');

  return (
    <div className={editorStyles.layout}>
      <header className={editorStyles.header}>
        <div className={editorStyles.headerLeft}>
          <Link to="/templates" className={editorStyles.backLink}>
            {t('templates.noteTypesBack')}
          </Link>
          <input
            className={editorStyles.nameInput}
            value={draft.name}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder={t('templates.templateNamePlaceholder')}
            aria-label={t('templates.templateNameAria')}
          />
        </div>
        <div className={editorStyles.headerActions}>
          {saveError && (
            <span className={editorStyles.error} role="alert">
              {saveError}
            </span>
          )}
          {savedAt && !saveError && (
            <span className={editorStyles.savedHint}>
              {t('templates.saved')}
            </span>
          )}
          <button
            type="button"
            className={sharedStyles.btnSecondary}
            onClick={handleDownload}
          >
            {t('templates.downloadApkg')}
          </button>
          <button
            type="button"
            className={sharedStyles.btnPrimary}
            onClick={handleSave}
            disabled={saving}
          >
            {getSaveLabel(saving, shouldFork, t)}
          </button>
        </div>
      </header>

      <div className={editorStyles.descriptionRow}>
        <input
          className={editorStyles.descriptionInput}
          value={draft.description}
          onChange={(event) => handleDescriptionChange(event.target.value)}
          placeholder={t('templates.oneLineDesc')}
          aria-label={t('templates.descriptionAria')}
        />
      </div>

      <div className={editorStyles.fieldsSection}>
        <div className={editorStyles.fieldsHeader}>
          <span className={editorStyles.fieldsLabel}>
            {t('templates.fields')}
          </span>
          <button
            type="button"
            className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
            onClick={() => setDraft((current) => addFieldOp(current))}
          >
            {t('templates.addField')}
          </button>
        </div>
        <div className={editorStyles.fieldsList}>
          {draft.noteType.flds.map((field, index) => (
            <div
              key={`${field.ord}-${field.name}`}
              className={editorStyles.fieldRow}
            >
              <input
                className={editorStyles.fieldNameInput}
                value={field.name}
                onChange={(event) =>
                  setDraft((current) =>
                    renameFieldOp(current, index, event.target.value)
                  )
                }
                aria-label={t('templates.fieldNameAria', { index: index + 1 })}
              />
              <input
                className={editorStyles.fieldPreviewInput}
                value={draft.previewData[field.name] ?? ''}
                onChange={(event) =>
                  setDraft((current) =>
                    setPreviewValueOp(current, field.name, event.target.value)
                  )
                }
                placeholder={t('templates.fieldPreviewPlaceholder', {
                  name: field.name,
                })}
                aria-label={t('templates.fieldPreviewAria', {
                  name: field.name,
                })}
              />
              <button
                type="button"
                className={`${sharedStyles.btnSecondary} ${editorStyles.fieldRemove}`}
                onClick={() =>
                  setDraft((current) => removeFieldOp(current, index))
                }
                disabled={draft.noteType.flds.length <= 1}
                aria-label={t('templates.removeFieldAria', {
                  name: field.name,
                })}
              >
                {t('templates.remove')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={editorStyles.workspace}>
        <div className={editorStyles.editorPane}>
          <div
            className={editorStyles.tabs}
            role="tablist"
            aria-label={t('templates.editPanes')}
          >
            {(['front', 'back', 'css'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={pane === value}
                className={`${editorStyles.tab} ${pane === value ? editorStyles.tabActive : ''}`}
                onClick={() => setPane(value)}
              >
                {value === 'front' && t('templates.front')}
                {value === 'back' && t('templates.back')}
                {value === 'css' && t('templates.paneStyling')}
              </button>
            ))}
          </div>
          <div className={editorStyles.editorBox}>
            <CodeEditor
              language={activeLanguage}
              value={activeValue}
              onChange={setActiveValue}
              ariaLabel={t('templates.editorAria', { pane })}
            />
          </div>
        </div>

        <div className={editorStyles.previewPane}>
          <div className={editorStyles.previewLabel}>
            {t('templates.livePreview', { side: sideLabel })}
          </div>
          <div className={editorStyles.previewFrameWrap}>
            <iframe
              title={t('templates.previewFrameTitle', {
                name: draft.name,
                side: sideLabel,
              })}
              className={editorStyles.previewFrame}
              sandbox="allow-scripts"
              srcDoc={previewDoc}
            />
          </div>
          <div className={editorStyles.chatPanel}>
            <div className={editorStyles.previewLabel}>
              {t('templates.askClaude')}
            </div>
            <div
              className={editorStyles.chatHistory}
              aria-live="polite"
              aria-atomic="false"
            >
              {chatHistory.length === 0 && !chatBusy && (
                <p className={editorStyles.chatEmpty}>
                  {t('templates.chatEmpty')}
                </p>
              )}
              {chatHistory.map((message, index) => (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  className={`${editorStyles.chatBubble} ${message.role === 'user' ? editorStyles.chatBubbleUser : editorStyles.chatBubbleAssistant}`}
                >
                  {message.content}
                </div>
              ))}
              {chatBusy && (
                <div
                  className={`${editorStyles.chatBubble} ${editorStyles.chatBubbleAssistant} ${editorStyles.chatPending}`}
                >
                  {t('templates.thinking')}
                </div>
              )}
            </div>
            {chatError && (
              <p className={editorStyles.aiError} role="alert">
                {chatError}
                {chatUpgradeUrl && (
                  <>
                    {' '}
                    <Link
                      to={chatUpgradeUrl}
                      className={editorStyles.aiUpgradeLink}
                    >
                      {t('templates.seePricing')}
                    </Link>
                  </>
                )}
                {!chatUpgradeUrl && lastAttempt && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={editorStyles.aiRetryButton}
                      onClick={handleRetry}
                      disabled={chatBusy}
                    >
                      {t('templates.tryAgain')}
                    </button>
                  </>
                )}
              </p>
            )}
            <div className={editorStyles.chatInputRow}>
              <input
                className={editorStyles.chatInput}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={t('templates.chatInputPlaceholder')}
                disabled={chatBusy}
                aria-label={t('templates.askClaude')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSendChat();
                  }
                }}
              />
              <button
                type="button"
                className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
                onClick={handleSendChat}
                disabled={chatBusy || chatInput.trim().length === 0}
              >
                {t('templates.send')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditorPageProps {
  mode: 'new' | 'edit';
}

export function EditorPage({ mode }: Readonly<EditorPageProps>) {
  const { t } = useTranslation('tools');
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<NoteTypeStarter | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shouldFork, setShouldFork] = useState(false);
  const [presetOptions, setPresetOptions] = useState<NoteTypeStarter[] | null>(
    null
  );
  const [pickedPreset, setPickedPreset] = useState<
    NoteTypeStarter | BaseType | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'new') {
      if (pickedPreset == null) {
        getDefaultNoteTypes()
          .then((defaults) => {
            if (!cancelled) setPresetOptions(defaults);
          })
          .catch(() => {
            if (!cancelled) setPresetOptions([]);
          });
        return;
      }
      if (pickedPreset === 'basic' || pickedPreset === 'cloze') {
        setInitial(buildEmptyNoteType(pickedPreset));
      } else {
        setInitial(duplicateStarter(pickedPreset));
      }
      setShouldFork(false);
      return;
    }
    if (!id) {
      setLoadError(t('templates.missingTemplateId'));
      return;
    }
    setLoadError(null);
    findStarter(id)
      .then(async (starter) => {
        if (cancelled) return;
        if (!starter) {
          setLoadError(t('templates.templateNotFound'));
          return;
        }
        const userPayload = await getUserTemplates().catch(() => ({
          templates: [],
          hiddenIds: [],
        }));
        const owned = userPayload.templates.some((t) => t.id === starter.id);
        setShouldFork(!owned);
        setInitial(starter);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : t('templates.couldNotLoadTemplate')
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, id, pickedPreset, t]);

  if (loadError) {
    return (
      <div className={sharedStyles.page}>
        <p className={galleryStyles.error} role="alert">
          {loadError}
        </p>
        <Link to="/templates" className={sharedStyles.btnSecondary}>
          {t('templates.backToNoteTypes')}
        </Link>
      </div>
    );
  }

  if (mode === 'new' && pickedPreset == null) {
    return (
      <PresetPicker
        loading={presetOptions == null}
        presets={presetOptions ?? []}
        onPick={setPickedPreset}
      />
    );
  }

  if (!initial) {
    return (
      <div className={sharedStyles.page}>
        <div className={sharedStyles.spinner ?? ''} />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>
          {mode === 'new'
            ? t('templates.newPageTitle')
            : t('templates.editTitle', { name: initial.name })}{' '}
          — 2anki
        </title>
      </Helmet>
      <EditorBody initialStarter={initial} shouldFork={shouldFork} />
    </>
  );
}

export default EditorPage;
