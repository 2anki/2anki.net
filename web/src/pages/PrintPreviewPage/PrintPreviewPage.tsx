import { useTranslation } from 'react-i18next';
import sharedStyles from '../../styles/shared.module.css';
import PrintPreview, {
  PrintPreviewState,
} from '../PrintPage/components/PrintPreview';
import previewStyles from './PrintPreviewPage.module.css';

const noop = () => undefined;

function cardSvg(rows: Array<[string, string]>): string {
  const header =
    "<rect x='0' y='0' width='600' height='40' fill='#f3f4f6'/>" +
    "<text x='16' y='26' font-family='sans-serif' font-size='14' fill='#111'>Front</text>" +
    "<text x='316' y='26' font-family='sans-serif' font-size='14' fill='#111'>Back</text>";
  const body = rows
    .map(([front, back], index) => {
      const y = 70 + index * 70;
      return (
        `<text x='16' y='${y}' font-family='sans-serif' font-size='13' fill='#333'>${front}</text>` +
        `<text x='316' y='${y}' font-family='sans-serif' font-size='13' fill='#333'>${back}</text>` +
        `<line x1='0' y1='${y + 20}' x2='600' y2='${y + 20}' stroke='#eee'/>`
      );
    })
    .join('');
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='280'>" +
    "<rect width='600' height='280' fill='#ffffff'/>" +
    header +
    "<line x1='300' y1='0' x2='300' y2='280' stroke='#ddd'/>" +
    body +
    '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const genericImage = cardSvg([
  ['What is the capital of France?', 'Paris'],
  ['H2O is the formula for…', 'Water'],
  ['The powerhouse of the cell', 'Mitochondria'],
]);

const audioImage = cardSvg([
  ['[audio: bonjour.mp3]', 'Hello'],
  ['[audio: merci.mp3]', 'Thank you'],
  ['[audio: au-revoir.mp3]', 'Goodbye'],
]);

interface Variant {
  label: string;
  note: string;
  state: PrintPreviewState;
  imageSrc: string | null;
  totalCards: number;
  previewedCards: number;
  paying: boolean;
  freePrintAvailable: boolean | null;
}

const variants: Variant[] = [
  {
    label: 'Free print available',
    note: 'Free signed-in user with their monthly print unused. Leads with "Download the full PDF" and the free-PDF hint.',
    state: 'ready',
    imageSrc: genericImage,
    totalCards: 42,
    previewedCards: 3,
    paying: false,
    freePrintAvailable: true,
  },
  {
    label: 'Free print used',
    note: 'Same user after spending their monthly print. Leads with the day pass; "See all plans" is the tertiary link.',
    state: 'ready',
    imageSrc: genericImage,
    totalCards: 42,
    previewedCards: 3,
    paying: false,
    freePrintAvailable: false,
  },
  {
    label: 'One or two card deck',
    note: 'Deck smaller than the preview cap: the caption says all cards, not a slice.',
    state: 'ready',
    imageSrc: genericImage,
    totalCards: 2,
    previewedCards: 2,
    paying: false,
    freePrintAvailable: true,
  },
  {
    label: 'Audio-heavy deck',
    note: 'Audio and video render as the same inline placeholder the PDF prints.',
    state: 'ready',
    imageSrc: audioImage,
    totalCards: 180,
    previewedCards: 3,
    paying: false,
    freePrintAvailable: true,
  },
  {
    label: 'Render failed',
    note: 'The preview could not be rendered. No payment ask — just a way to try another deck.',
    state: 'error',
    imageSrc: null,
    totalCards: 0,
    previewedCards: 0,
    paying: false,
    freePrintAvailable: true,
  },
];

export default function PrintPreviewPage() {
  const { t } = useTranslation('tools');

  return (
    <div className={previewStyles.outer}>
      <header className={previewStyles.outerHeader}>
        <h1 className={sharedStyles.title}>Print preview — states</h1>
        <p className={sharedStyles.subtitle}>
          Visual preview only. Not linked from navigation. Not gated by auth.
          Use the browser’s responsive mode at 375px to judge the stacked
          layout.
        </p>
      </header>

      <div className={previewStyles.grid}>
        {variants.map((variant) => (
          <article key={variant.label} className={previewStyles.variant}>
            <header className={previewStyles.variantHeader}>
              <h2 className={previewStyles.variantLabel}>{variant.label}</h2>
              <p className={previewStyles.variantNote}>{variant.note}</p>
            </header>
            <div className={previewStyles.frame}>
              <PrintPreview
                state={variant.state}
                imageSrc={variant.imageSrc}
                totalCards={variant.totalCards}
                previewedCards={variant.previewedCards}
                paying={variant.paying}
                freePrintAvailable={variant.freePrintAvailable}
                optionsChanged={false}
                downloadBusy={false}
                passBusy={false}
                errorMessage={
                  variant.state === 'error' ? t('print.genericError') : null
                }
                onUpdatePreview={noop}
                onDownload={noop}
                onPass={noop}
                onPreviewAnother={noop}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
