export const TOKUSHOHO_PATH = '/tokushoho';

export const TOKUSHOHO_TITLE = '特定商取引法に基づく表記';

export const TOKUSHOHO_DESCRIPTION =
  '2anki（Lær Smart AS）の特定商取引法に基づく表記です。販売業者、所在地、連絡先、販売価格、支払方法、提供時期、返品・キャンセルについて記載しています。';

export interface TokushohoLink {
  href: string;
  label: string;
}

export interface TokushohoRow {
  term: string;
  details: readonly string[];
  link?: TokushohoLink;
}

export const SUPPORT_EMAIL = 'support@2anki.net';

export const TOKUSHOHO_ROWS: readonly TokushohoRow[] = [
  {
    term: '販売業者',
    details: ['Lær Smart AS（ノルウェー法人、組織番号 933 898 253）'],
  },
  {
    term: '運営統括責任者',
    details: ['【未記入：代表者の氏名】'],
  },
  {
    term: '所在地',
    details: [
      'ノルウェー王国 オスロ 【未記入：登記上の住所（番地・郵便番号）】',
    ],
  },
  {
    term: '電話番号',
    details: ['請求があった場合、遅滞なく開示します。'],
  },
  {
    term: 'メールアドレス',
    details: [],
    link: { href: `mailto:${SUPPORT_EMAIL}`, label: SUPPORT_EMAIL },
  },
  {
    term: '販売価格',
    details: [
      '各プランの価格は、料金ページに表示しています（税込）。',
      '価格は米ドル（USD）で表示しています。チェックアウトで現地通貨で表示・請求される場合があります。',
    ],
    link: { href: '/pricing/', label: '料金ページ' },
  },
  {
    term: '商品代金以外の必要料金',
    details: [
      'インターネット接続にかかる通信料は、お客様のご負担となります。それ以外の料金はかかりません。',
    ],
  },
  {
    term: '支払方法',
    details: [
      'クレジットカード・デビットカード。',
      'お使いの端末や地域によっては、Apple Pay、Google Pay など、チェックアウト画面に表示されるその他の支払い方法もご利用いただけます。',
    ],
  },
  {
    term: '支払時期',
    details: [
      'ご購入時にお支払いいただきます。サブスクリプションは、以降の更新日ごとに自動で請求されます。',
    ],
  },
  {
    term: '提供時期',
    details: ['お支払いの完了後、すぐにご利用いただけます。'],
  },
  {
    term: '返品・キャンセル',
    details: [
      'サブスクリプションは、アカウントからワンクリックでいつでも解約できます。サポートへの連絡は不要です。',
      '解約すると次回の更新が停止し、すでにお支払いいただいた期間の終了までご利用いただけます。年額プランの未使用期間は返金されません。',
      'パスは一回払いの商品で、自動更新はありません。解約の手続きは不要です。',
    ],
  },
  {
    term: '動作環境',
    details: [
      'Google Chrome、Microsoft Edge、Mozilla Firefox、Safari の最新版（パソコン・スマートフォン）。JavaScript を有効にしてご利用ください。',
    ],
  },
];
