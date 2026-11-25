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

interface Held {
  files: File[];
  kept: boolean | null;
}

// The offer shows only where the server says so: to a signed-out visitor
// while the gift is open, and to a signed-in account that holds or can get
// gift credits. Anyone else gets the upload form exactly as it is.
function activeOffer(
  offer: GiftOffer | null,
  signedIn: boolean | undefined
): GiftOffer | null {
  if (offer == null || signedIn == null) return null;
  return signedIn === offer.hasCredits ? offer : null;
}

function SignedInFootnote({ offer }: Readonly<{ offer: GiftOffer }>) {
  const { t } = useTranslation('aiGift');
  if (offer.usableNow) {
    return <>{t('card.footnoteSignedIn', { count: offer.credits })}</>;
  }
  if (offer.inUse) return <>{t('inUseNow')}</>;
  return <>{t('fewCardsLeft', { count: offer.monthlyCardsLeft ?? 0 })}</>;
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
  const status = useAiGift(signedIn);
  const offer = activeOffer(giftOfferOf(status), session);
  const active = offer != null;
  const usable = offer?.usableNow === true;
  const [mode, setMode] = useState<UploadMode>('notion');
  const [held, setHeld] = useState<Held | null>(null);
  const shownRef = useRef(false);
  const modeTrackedRef = useRef(false);

  const handOff = (files: File[], claude: boolean | null) => {
    setHeld(null);
    navigate('/upload', { state: giftHandoffState({ files, claude }) });
  };

  const keepForSignup = (files: File[]) => {
    setHeld({ files, kept: null });
    void heldFiles.save(files).then((kept) => {
      setHeld((current) =>
        current?.files === files ? { files, kept } : current
      );
    });
  };

  const take = (files: File[], via: 'card' | 'page') => {
    track('file_dropped', {
      surface: SURFACE,
      mode,
      via,
      signed_in: signedIn,
      format: uploadInputFormat(files),
    });
    if (!signedIn) {
      keepForSignup(files);
    } else if (usable && readByClaudeCards(files)) {
      setHeld({ files, kept: true });
    } else {
      handOff(files, null);
    }
  };

  useEffect(() => {
    if (!active || shownRef.current) return;
    shownRef.current = true;
    track('upload_card_viewed', { surface: SURFACE, signed_in: signedIn });
  }, [active, signedIn]);

  // The file kept through sign-up comes back whenever the person is signed
  // in, once the gift status is known: to the convert step while the gift can
  // pay for it, and to the upload form as it is otherwise.
  const statusKnown = status != null;
  useEffect(() => {
    if (!signedIn || !statusKnown) return;
    let live = true;
    void heldFiles.take().then((files) => {
      if (!live || files == null) return;
      if (usable && readByClaudeCards(files)) {
        setMode('ai');
        setHeld({ files, kept: true });
      } else {
        handOff(files, null);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, statusKnown, heldFiles]);

  const holdChosenFiles: HoldChosenFiles = (files) => {
    if (signedIn) {
      if (!usable || !readByClaudeCards(files)) return false;
    } else if (mode !== 'ai' || !acceptedByGift(files)) {
      return false;
    }
    take(files, 'page');
    return true;
  };

  const chooseMode = (next: UploadMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === 'ai' && !modeTrackedRef.current) {
      modeTrackedRef.current = true;
      track('ai_mode_selected', { surface: SURFACE, signed_in: signedIn });
    }
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
    handOff(held.files, claude);
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
            files={held.files}
            creditsLeft={offer.credits}
            switchOnByDefault={offer.switchOnByDefault}
            onConvert={convert}
            onRemove={() => setHeld(null)}
          />
        )}
        {offer != null && held != null && !signedIn && (
          <GiftSignupStep
            files={held.files}
            kept={held.kept}
            onRemove={() => setHeld(null)}
          />
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
          {signedIn ? (
            <SignedInFootnote offer={offer} />
          ) : (
            t('card.footnoteSignedOut', { count: offer.credits })
          )}
        </p>
      )}
    </>
  );
}
