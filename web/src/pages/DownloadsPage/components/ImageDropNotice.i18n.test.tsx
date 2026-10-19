import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../lib/i18n';
import { ImageDropNotice } from './ImageDropNotice';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

describe('ImageDropNotice notionAsset in Polish', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('pl');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('uses the Polish few plural form for three dropped assets', () => {
    render(<ImageDropNotice count={3} source="notionAsset" />);
    expect(
      screen.getByText(/3 pliki lub obrazy nie zostały pobrane/)
    ).toBeInTheDocument();
  });
});
