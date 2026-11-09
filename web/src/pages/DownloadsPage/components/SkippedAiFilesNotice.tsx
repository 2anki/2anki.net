import { useTranslation } from 'react-i18next';
import type { SkippedAiFile } from '../../../lib/interfaces/UserUpload';

// A Map so a reason off the wire can never reach an Object.prototype key.
const WHY_KEYS = new Map<string, string>([
  ['declined', 'skippedAiFiles.why.declined'],
  ['too_large', 'skippedAiFiles.why.too_large'],
  ['no_text', 'skippedAiFiles.why.no_text'],
  ['unreadable', 'skippedAiFiles.why.unreadable'],
]);

const LISTED_FILES = 5;

interface SkippedAiFilesNoticeProps {
  files: SkippedAiFile[];
}

export function SkippedAiFilesNotice({
  files,
}: Readonly<SkippedAiFilesNoticeProps>) {
  const { t } = useTranslation('downloadsx');
  const named = files.flatMap((file) => {
    const whyKey = WHY_KEYS.get(file.reason);
    return whyKey == null ? [] : [{ name: file.name, why: t(whyKey) }];
  });
  if (named.length === 0) return null;
  const unlisted = named.length - LISTED_FILES;

  return (
    <div style={{ overflowWrap: 'anywhere' }}>
      <p>{t('skippedAiFiles.lead', { count: named.length })}</p>
      <ul>
        {named.slice(0, LISTED_FILES).map(({ name, why }, index) => (
          <li key={`${index}-${name}`}>
            <span data-hj-suppress>{name}</span>: {why}
          </li>
        ))}
      </ul>
      {unlisted > 0 && <p>{t('skippedAiFiles.more', { count: unlisted })}</p>}
    </div>
  );
}
