import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './ComparisonTable.module.css';

const PLANS = ['Free', 'Day / Week pass', 'Unlimited'];

type Cell = boolean | string;

interface Row {
  label: string;
  values: [Cell, Cell, Cell];
}

interface Group {
  name: string;
  rows: Row[];
}

function CheckIcon() {
  return (
    <svg
      className={styles.check}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface ComparisonTableProps {
  unlimitedMonthlyPrice: string;
}

export function ComparisonTable({
  unlimitedMonthlyPrice,
}: Readonly<ComparisonTableProps>) {
  const { t } = useTranslation('pricingtable');

  const unlimited = t('cells.unlimited');

  const groups: Group[] = [
    {
      name: t('groups.conversionLimits'),
      rows: [
        {
          label: t('rows.cardsPerMonth'),
          values: ['100', unlimited, unlimited],
        },
        {
          label: t('rows.conversionsAtOnce'),
          values: ['1', unlimited, unlimited],
        },
        {
          label: t('rows.pdfPagesPerFile'),
          values: ['100', unlimited, unlimited],
        },
        {
          label: t('rows.maxUploadSize'),
          values: ['100 MB', '10 GB', '10 GB'],
        },
        {
          label: t('rows.ankiNotionNotes'),
          values: ['1,000', '10,000', '10,000'],
        },
      ],
    },
    {
      name: t('groups.ai'),
      rows: [
        {
          label: t('rows.aiFlashcards'),
          values: [false, true, true],
        },
        {
          label: t('rows.photoToDeck'),
          values: [t('cells.photoPerMonth'), unlimited, unlimited],
        },
        {
          label: t('rows.aiMcq'),
          values: [false, true, true],
        },
        {
          label: t('rows.aiCardTemplate'),
          values: ['3', unlimited, unlimited],
        },
      ],
    },
    {
      name: t('groups.studyTools'),
      rows: [
        {
          label: t('rows.imageOcclusion'),
          values: [t('cells.imagesQty'), unlimited, unlimited],
        },
        {
          label: t('rows.mindMaps'),
          values: ['3', '25', '25'],
        },
        {
          label: t('rows.printsToPdf'),
          values: [t('cells.printsPerMonth'), unlimited, unlimited],
        },
      ],
    },
    {
      name: t('groups.syncSupport'),
      rows: [
        {
          label: t('rows.prioritySupport'),
          values: [false, false, true],
        },
      ],
    },
    {
      name: t('groups.billing'),
      rows: [
        {
          label: t('rows.noSubscription'),
          values: [true, true, false],
        },
      ],
    },
  ];

  const renderCell = (value: Cell) => {
    if (value === true) {
      return (
        <>
          <CheckIcon />
          <span className={styles.srOnly}>{t('included')}</span>
        </>
      );
    }
    if (value === false) {
      return (
        <>
          <span className={styles.dash} aria-hidden="true">
            –
          </span>
          <span className={styles.srOnly}>{t('notIncluded')}</span>
        </>
      );
    }
    return value;
  };

  const planPrices = ['$0', '$6 / $12', `${unlimitedMonthlyPrice} / mo`];

  return (
    <section className={styles.section} aria-labelledby="comparison-heading">
      <h2 id="comparison-heading" className={styles.heading}>
        {t('heading')}
      </h2>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.cornerCell}>
                <span className={styles.srOnly}>{t('srFeature')}</span>
              </th>
              {PLANS.map((plan, i) => (
                <th key={plan} scope="col" className={styles.planCell}>
                  <span className={styles.planName}>{plan}</span>
                  <span className={styles.planPrice}>{planPrices[i]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.name}>
                <tr className={styles.groupRow}>
                  <th
                    scope="colgroup"
                    colSpan={PLANS.length + 1}
                    className={styles.groupCell}
                  >
                    {group.name}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.label} className={styles.row}>
                    <th scope="row" className={styles.rowLabel}>
                      {row.label}
                    </th>
                    {row.values.map((value, i) => (
                      <td key={PLANS[i]} className={styles.valueCell}>
                        {renderCell(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
