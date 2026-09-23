import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShowcase } from './useShowcase';
import { ShowcaseBlock } from '../../lib/backend/getShowcase';
import { CardFrame } from '../PreviewApkgPage/CardFrame';
import styles from './ShowcaseSection.module.css';

function NotionBlock({
  block,
  defaultOpen,
}: Readonly<{ block: ShowcaseBlock; defaultOpen?: boolean }>) {
  const { t } = useTranslation();
  if (block.canExpand && block.summaryHtml) {
    return (
      <details className={styles.toggle} open={defaultOpen}>
        <summary
          className={styles.toggleSummary}
          dangerouslySetInnerHTML={{ __html: block.summaryHtml }}
        />
        {block.childrenHtml ? (
          <div
            className={styles.toggleContent}
            dangerouslySetInnerHTML={{ __html: block.childrenHtml }}
          />
        ) : (
          <div className={styles.toggleContentEmpty}>
            {t('home.showcase.clozeEmptyNote')}
          </div>
        )}
      </details>
    );
  }

  const html = block.html || block.summaryHtml;
  if (!html) return null;

  return (
    <div
      className={styles.notionBlock}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ShowcaseSection() {
  const { t } = useTranslation();
  const { data } = useShowcase();
  const [cardIndex, setCardIndex] = useState(0);

  if (data == null) return null;
  if (data.notionBlocks.length === 0 && data.ankiCards.length === 0) {
    return null;
  }

  const totalCards = data.ankiCards.length;
  const card = data.ankiCards[cardIndex];

  return (
    <section className={styles.showcaseSection}>
      <div className={styles.showcaseInner}>
        <p className={styles.showcaseHeading}>{t('home.showcase.heading')}</p>
        <div className={styles.showcaseGrid}>
          <div className={styles.showcaseColumn}>
            <p className={styles.columnLabel}>Notion</p>
            <div className={styles.notionBlocks}>
              {data.notionBlocks.map((block, index) => (
                <NotionBlock
                  key={block.id}
                  block={block}
                  defaultOpen={index === 0}
                />
              ))}
            </div>
          </div>
          <div className={styles.showcaseColumn}>
            <p className={styles.columnLabel}>Anki</p>
            {card && <CardFrame card={card} />}
            {totalCards > 1 && (
              <div className={styles.carouselNav}>
                <button
                  type="button"
                  className={styles.carouselBtn}
                  onClick={() => setCardIndex((i) => i - 1)}
                  disabled={cardIndex === 0}
                  aria-label={t('home.showcase.previousCard')}
                >
                  ←
                </button>
                <span className={styles.carouselCount}>
                  {cardIndex + 1} / {totalCards}
                </span>
                <button
                  type="button"
                  className={styles.carouselBtn}
                  onClick={() => setCardIndex((i) => i + 1)}
                  disabled={cardIndex === totalCards - 1}
                  aria-label={t('home.showcase.nextCard')}
                >
                  →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
