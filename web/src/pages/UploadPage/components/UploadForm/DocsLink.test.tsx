import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Trans } from 'react-i18next';

import i18n from '../../../../lib/i18n';
import deCommon from '../../../../lib/i18n/locales/de/common.json';
import DocsLink from './DocsLink';

function renderTextFileHint() {
  return render(
    <Trans
      i18nKey="upload.form.emptyTextFile"
      components={{
        problemsLink: <DocsLink href="/documentation/help/common-problems" />,
      }}
    />
  );
}

describe('DocsLink inside a translated sentence', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the tagged words as a link to the docs page', () => {
    renderTextFileHint();

    expect(
      screen.getByRole('link', { name: 'common problems' })
    ).toHaveAttribute('href', '/documentation/help/common-problems');
  });

  it('uses the translated words as the link text', async () => {
    await i18n.changeLanguage('de');
    renderTextFileHint();

    const linkText = /<problemsLink>(.*)<\/problemsLink>/.exec(
      deCommon.upload.form.emptyTextFile
    )?.[1];
    expect(linkText).not.toBe('common problems');
    expect(screen.getByRole('link', { name: linkText })).toHaveAttribute(
      'href',
      '/documentation/help/common-problems'
    );
  });
});
