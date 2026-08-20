import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createDeckShare,
  revokeDeckShare,
  getActiveSharesForUploadKey,
  ActiveShare,
} from '../../lib/backend/getSharedDeck';
import styles from './SharePopover.module.css';

interface SharePopoverProps {
  uploadKey: string;
}

interface PopoverBodyProps {
  loading: boolean;
  share: ActiveShare | null;
  showConfirm: boolean;
  onCopy: () => void;
  onStopRequest: () => void;
  onStopConfirm: () => void;
  onKeepSharing: () => void;
}

function PopoverBody({
  loading,
  share,
  showConfirm,
  onCopy,
  onStopRequest,
  onStopConfirm,
  onKeepSharing,
}: Readonly<PopoverBodyProps>) {
  const { t } = useTranslation('previews');
  if (loading) {
    return <p className={styles.loadingText}>{t('share.creatingLink')}</p>;
  }
  if (share == null) {
    return (
      <p className={styles.loadingText}>{t('share.unableToCreateLink')}</p>
    );
  }
  return (
    <>
      <div className={styles.urlRow}>
        <input
          type="text"
          readOnly
          value={share.url}
          className={styles.urlInput}
          aria-label={t('share.shareLink')}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className={styles.copyButton} onClick={onCopy}>
          {t('share.copyLink')}
        </button>
      </div>
      <p className={styles.helperText}>{t('share.helper')}</p>
      {showConfirm ? (
        <div className={styles.confirmDialog}>
          <p className={styles.confirmText}>{t('share.stopConfirm')}</p>
          <div className={styles.confirmButtons}>
            <button
              type="button"
              className={styles.stopButton}
              onClick={onStopConfirm}
            >
              {t('share.stopSharing')}
            </button>
            <button
              type="button"
              className={styles.keepButton}
              onClick={onKeepSharing}
            >
              {t('share.keepSharing')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.stopLink}
          onClick={onStopRequest}
        >
          {t('share.stopSharing')}
        </button>
      )}
    </>
  );
}

export function SharePopover({ uploadKey }: Readonly<SharePopoverProps>) {
  const { t } = useTranslation('previews');
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<ActiveShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loading) return;
    let cancelled = false;
    setLoading(true);
    getActiveSharesForUploadKey(uploadKey)
      .then((existing) => {
        if (cancelled) return;
        if (existing == null) {
          return createDeckShare(uploadKey).then((result) => {
            if (cancelled) return;
            setShare({
              token: result.token,
              upload_key: uploadKey,
              url: result.url,
              created_at: new Date().toISOString(),
              view_count: 0,
            });
          });
        } else {
          setShare(existing);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, uploadKey]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        anchorRef.current &&
        e.target instanceof Node &&
        !anchorRef.current.contains(e.target)
      ) {
        setOpen(false);
        setShowConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const copyLink = async () => {
    if (share == null) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    } catch {
      // Clipboard API unavailable — the URL is selectable in the input.
    }
  };

  const stopSharing = async () => {
    if (share == null) return;
    try {
      await revokeDeckShare(share.token);
      setShare(null);
      setShowConfirm(false);
      setOpen(false);
    } catch {}
  };

  return (
    <>
      <div className={styles.anchor} ref={anchorRef}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => {
            setOpen((prev) => !prev);
            setShowConfirm(false);
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {t('share.share')}
        </button>

        {open && (
          <dialog
            open
            className={styles.popover}
            aria-label={t('share.shareThisDeck')}
          >
            <p className={styles.popoverTitle}>{t('share.shareThisDeck')}</p>
            <PopoverBody
              loading={loading}
              share={share}
              showConfirm={showConfirm}
              onCopy={copyLink}
              onStopRequest={() => setShowConfirm(true)}
              onStopConfirm={stopSharing}
              onKeepSharing={() => setShowConfirm(false)}
            />
          </dialog>
        )}
      </div>

      {showToast && (
        <div className={styles.toast} role="status" aria-live="polite">
          {t('share.linkCopied')}
        </div>
      )}
    </>
  );
}
