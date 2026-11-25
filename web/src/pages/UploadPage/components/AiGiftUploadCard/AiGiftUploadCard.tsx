import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAiGift } from '../../../../lib/hooks/useAiGift';
import { giftOfferOf, type GiftOffer } from '../../../../lib/backend/aiGift';
import { track } from '../../../../lib/analytics/track';
import { useUploadZoneActivity } from '../../../../lib/upload/uploadZoneActivity';
import { giftHandoffState } from '../../../../lib/aiGift/giftHandoff';
import {
  getHeldGiftFileStore,
  type HeldGiftFileStore,
} from '../../../../lib/aiGift/heldGiftFile';
import {
  acceptedByGift,
  allPhotos,
  readByClaudeCards,
} from '../../../../lib/aiGift/giftFileKinds';
import { recordAiChoice } from '../../../../lib/data_layer/aiChoice';
import { saveValueInLocalStorage } from '../../../../lib/data_layer/saveValueInLocalStorage';
import { UploadModeSwitch, type UploadMode } from './UploadModeSwitch';
import { AiNotesDropzone } from './AiNotesDropzone';
import { GiftConvertStep } from './GiftConvertStep';
import { GiftSignupStep } from './GiftSignupStep';
import { uploadInputFormat } from './uploadInputFormat';
import styles from './AiGiftUploadCard.module.css';

const AI_FLAG_KEY = 'claude-ai-flashcards';
const SURFACE = 'upload_card';

// Asked by the upload form once a chosen file passed its own checks: true
// when the card takes the file instead of the form sending it.
export type HoldChosenFiles = (files: File[]) => boolean;

interface Props {
  // undefined while the session is still loading: the offer waits for it.
  signedIn: boolean | undefined;
  children: (holdChosenFiles: HoldChosenFiles | undefined) => ReactNode;
  heldFiles?: HeldGiftFileStore;
}

// The offer shows only where the server says so: to a signed-out visitor
// while the gift is open, and to a signed-in account whose next upload runs
// on gift credits. Anyone else gets the upload form exactly as it is.
function activeOffer(
  offer: GiftOffer | null,
  signedIn: boolean | undefined
): GiftOffer | null {
  if (offer == null || signedIn == null) return null;
  return signedIn === offer.hasCredits ? offer : null;
}

export function AiGiftUploadCard({
  signedIn: session,
  children,
  heldFiles = getHeldGiftFileStore(),
}: Readonly<Props>) {
  const signedIn = session === true;
  const { t } = useTranslation('aiGift');
  const navigate = useNavigate();
  const zone = useUploadZoneActivity();
  const offer = activeOffer(giftOfferOf(useAiGift(signedIn)), session);
  const active = offer != null;
  const [mode, setMode] = useState<UploadMode>('notion');
  const [held, setHeld] = useState<File[] | null>(null);
  const shownRef = useRef(false);

  const handOff = (files: File[], claude: boolean | null) => {
    setHeld(null);
    navigate('/upload', { state: giftHandoffState({ files, claude }) });
  };

  const take = (files: File[], via: 'card' | 'page') => {
    track('ai_gift_file_dropped', {
      surface: SURFACE,
      mode,
      via,
      signed_in: signedIn,
      format: uploadInputFormat(files),
    });
    if (!signedIn) {
      setHeld(files);
      void heldFiles.save(files);
    } else if (readByClaudeCards(files)) {
      setHeld(files);
    } else {
      handOff(files, null);
    }
  };

  useEffect(() => {
    if (!active || shownRef.current) return;
    shownRef.current = true;
    track('ai_gift_shown', { surface: SURFACE, signed_in: signedIn });
  }, [active, signedIn]);

  useEffect(() => {
    if (!active || !signedIn) return;
    let live = true;
    void heldFiles.take().then((files) => {
      if (!live || files == null) return;
      setMode('ai');
      if (allPhotos(files)) {
        handOff(files, null);
      } else {
        setHeld(files);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, signedIn, heldFiles]);

  const holdChosenFiles: HoldChosenFiles = (files) => {
    if (signedIn) {
      if (!readByClaudeCards(files)) return false;
    } else if (mode !== 'ai' || !acceptedByGift(files)) {
      return false;
    }
    take(files, 'page');
    return true;
  };

  const chooseMode = (next: UploadMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === 'ai') track('ai_gift_opened', { surface: SURFACE });
  };

  const convert = (claude: boolean, changed: boolean) => {
    if (held == null) return;
    if (changed) {
      saveValueInLocalStorage(AI_FLAG_KEY, String(claude), null);
      recordAiChoice();
      track(claude ? 'upload_ai_turned_on' : 'upload_ai_turned_off', {
        surface: 'convert_step',
      });
    }
    handOff(held, claude);
  };

  const holding = active && held != null;
  const formShown = !holding && (mode === 'notion' || zone === 'busy');
  const dropzoneShown = active && !holding && mode === 'ai' && zone !== 'busy';

  // The form keeps one place in the tree whether or not the offer shows, so
  // the offer arriving after the gift status loads never remounts it.
  return (
    <>
      <div
        className={active ? styles.card : styles.passThrough}
        data-testid="upload-card"
      >
        {active && <UploadModeSwitch mode={mode} onChange={chooseMode} />}
        {offer != null && held != null && signedIn && (
          <GiftConvertStep
            files={held}
            creditsLeft={offer.credits}
            claudeByDefault={offer.claudeByDefault}
            onConvert={convert}
            onRemove={() => setHeld(null)}
          />
        )}
        {offer != null && held != null && !signedIn && (
          <GiftSignupStep files={held} onRemove={() => setHeld(null)} />
        )}
        {dropzoneShown && (
          <AiNotesDropzone onFiles={(files) => take(files, 'card')} />
        )}
        <div
          className={active ? undefined : styles.passThrough}
          hidden={active && !formShown}
        >
          {children(active ? holdChosenFiles : undefined)}
        </div>
      </div>
      {offer != null && (
        <p className={styles.footnote}>
          {signedIn
            ? t('card.footnoteSignedIn', { count: offer.credits })
            : t('card.footnoteSignedOut', { count: offer.credits })}
        </p>
      )}
    </>
  );
}
