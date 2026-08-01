import { FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import styles from '../../styles/shared.module.css';
import contactStyles from './ContactPage.module.css';

type FormStatus = 'idle' | 'sending' | 'sent' | 'error';

export function ContactPage() {
  const { t } = useTranslation('marketing');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<FormStatus>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit =
    status !== 'sending' &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    message.trim().length > 0;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('sending');
    try {
      await get2ankiApi().contactUs(name, email, message, files, website);
      setStatus('sent');
      setName('');
      setEmail('');
      setMessage('');
      setWebsite('');
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeaderCenter}>
        <h1 className={styles.title}>{t('contact.title')}</h1>
        <p className={styles.subtitle}>{t('contact.subtitle')}</p>
      </header>

      <div className={contactStyles.layout}>
        <section className={styles.surface}>
          <h2 className={styles.surfaceTitle}>{t('contact.sendTitle')}</h2>
          <p className={contactStyles.formLead}>{t('contact.formLead')}</p>

          {status === 'sent' && (
            <div className={styles.alertSuccess}>{t('contact.sentAlert')}</div>
          )}
          {status === 'error' && (
            <div className={styles.alertDanger}>
              {t('contact.errorPrefix')}
              <a href="mailto:support@2anki.net">support@2anki.net</a>
              {t('contact.errorSuffix')}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className={contactStyles.honeypot} aria-hidden="true">
              <label htmlFor="contact-website">Website</label>
              <input
                id="contact-website"
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="contact-name">{t('contact.nameLabel')}</label>
              <input
                id="contact-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('contact.namePlaceholder')}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="contact-email">{t('contact.emailLabel')}</label>
              <input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('contact.emailPlaceholder')}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="contact-message">
                {t('contact.messageLabel')}
              </label>
              <textarea
                id="contact-message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('contact.messagePlaceholder')}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="contact-files">
                {t('contact.attachments')}{' '}
                <span className={contactStyles.optional}>
                  {t('contact.optional')}
                </span>
              </label>
              <input
                ref={fileInputRef}
                id="contact-files"
                type="file"
                multiple
                onChange={handleFileChange}
                className={contactStyles.fileInput}
              />
              {files.length > 0 && (
                <ul className={contactStyles.fileList}>
                  {files.map((f, i) => (
                    <li key={f.name} className={contactStyles.fileItem}>
                      <span className={contactStyles.fileName}>{f.name}</span>
                      <button
                        type="button"
                        className={contactStyles.fileRemove}
                        onClick={() => removeFile(i)}
                        aria-label={t('contact.removeFile', { name: f.name })}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={!canSubmit}
            >
              {status === 'sending'
                ? t('contact.sending')
                : t('contact.sendMessage')}
            </button>
          </form>
        </section>

        <aside className={contactStyles.sidebar}>
          <div className={styles.surface}>
            <h3 className={styles.sectionTitle}>
              {t('contact.emailDirectTitle')}
            </h3>
            <p className={contactStyles.cardText}>
              {t('contact.emailDirectPrefix')}
              <a href="mailto:support@2anki.net">support@2anki.net</a>
              {t('contact.emailDirectSuffix')}
            </p>
            <ul className={contactStyles.tipList}>
              <li>{t('contact.tip1')}</li>
              <li>{t('contact.tip2')}</li>
              <li>{t('contact.tip3')}</li>
            </ul>
          </div>

          <div className={styles.surface}>
            <h3 className={styles.sectionTitle}>{t('contact.shareTitle')}</h3>
            <p className={contactStyles.cardText}>
              {t('contact.sharePrefix')}
              <a href="mailto:support@2anki.net">support@2anki.net</a>
              {t('contact.shareSuffix')}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
