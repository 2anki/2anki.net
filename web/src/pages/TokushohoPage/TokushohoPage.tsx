import { Helmet } from 'react-helmet-async';

import styles from '../../styles/shared.module.css';
import pageStyles from './TokushohoPage.module.css';
import { canonicalUrl } from '../../lib/seo/canonicalUrl';
import { useCanonicalLink } from '../../lib/seo/useCanonicalLink';
import {
  TOKUSHOHO_DESCRIPTION,
  TOKUSHOHO_PATH,
  TOKUSHOHO_ROWS,
  TOKUSHOHO_TITLE,
} from './tokushohoContent';

export default function TokushohoPage() {
  useCanonicalLink(canonicalUrl(TOKUSHOHO_PATH));
  return (
    <div className={styles.page} lang="ja">
      <Helmet>
        <title>{`${TOKUSHOHO_TITLE} | 2anki`}</title>
        <meta name="description" content={TOKUSHOHO_DESCRIPTION} />
      </Helmet>
      <h1 className={styles.title}>{TOKUSHOHO_TITLE}</h1>
      <table className={pageStyles.table}>
        <tbody>
          {TOKUSHOHO_ROWS.map((row) => (
            <tr key={row.term}>
              <th scope="row">{row.term}</th>
              <td>
                {row.details.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {row.link != null && (
                  <p>
                    <a href={row.link.href}>{row.link.label}</a>
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
