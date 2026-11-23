import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HelmetProvider } from 'react-helmet-async';
import { describe, expect, it } from 'vitest';

import TokushohoPage from './TokushohoPage';
import { TOKUSHOHO_ROWS } from './tokushohoContent';

function renderPage() {
  return render(
    <HelmetProvider>
      <TokushohoPage />
    </HelmetProvider>
  );
}

describe('TokushohoPage', () => {
  it('titles the page as the seller disclosure', () => {
    renderPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: '特定商取引法に基づく表記',
      })
    ).toBeInTheDocument();
  });

  it.each([
    '販売業者',
    '運営統括責任者',
    '所在地',
    '電話番号',
    'メールアドレス',
    '販売価格',
    '商品代金以外の必要料金',
    '支払方法',
    '支払時期',
    '提供時期',
    '返品・キャンセル',
    '動作環境',
  ])('lists the %s field', (term) => {
    renderPage();
    expect(screen.getByRole('rowheader', { name: term })).toBeInTheDocument();
  });

  it('names Lær Smart AS as the seller', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /販売業者/ });
    expect(row).toHaveTextContent('Lær Smart AS');
  });

  it('names the person responsible for operations', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /運営統括責任者/ });
    expect(row).toHaveTextContent('Alexander Alemayhu');
  });

  it('gives the city and discloses the full address on request', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /所在地/ });
    expect(row).toHaveTextContent('ノルウェー王国 オスロ');
    expect(row).toHaveTextContent(
      '番地を含む住所は、請求があった場合、遅滞なく開示します。'
    );
  });

  it('states that passes are not refunded after purchase', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /返品・キャンセル/ });
    expect(row).toHaveTextContent(
      'パスはお支払い後すぐにご利用いただけるため、ご購入後の返金はできません。'
    );
  });

  it('ships no unfilled placeholder in any row', () => {
    const withPlaceholder = TOKUSHOHO_ROWS.filter((row) =>
      [row.term, ...row.details, row.link?.label ?? ''].some((text) =>
        text.includes('未記入')
      )
    ).map((row) => row.term);
    expect(withPlaceholder).toEqual([]);
  });

  it('discloses the phone number on request', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /電話番号/ });
    expect(row).toHaveTextContent('請求があった場合、遅滞なく開示します');
  });

  it('links the support address', () => {
    renderPage();
    expect(
      screen.getByRole('link', { name: 'support@2anki.net' })
    ).toHaveAttribute('href', 'mailto:support@2anki.net');
  });

  it('links the pricing page from the price row', () => {
    renderPage();
    expect(screen.getByRole('link', { name: '料金ページ' })).toHaveAttribute(
      'href',
      '/pricing/'
    );
  });

  it('marks the content as Japanese', () => {
    const { container } = renderPage();
    expect(container.querySelector('[lang="ja"]')).toHaveTextContent(
      '特定商取引法に基づく表記'
    );
  });
});
