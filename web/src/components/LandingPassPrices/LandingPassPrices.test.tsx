import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../lib/i18n';
import { LandingPassPrices } from './LandingPassPrices';

vi.mock('../../lib/hooks/useLandingPassPrices', () => ({
  useLandingPassPricesEnabled: vi.fn(),
}));

vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: vi.fn(),
}));

import { useLandingPassPricesEnabled } from '../../lib/hooks/useLandingPassPrices';
import { usePassPrices } from '../../lib/hooks/usePassPrices';

describe('LandingPassPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePassPrices).mockReturnValue({
      '24h': '$6',
      '7d': '$12',
      '120d': '$29',
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing while the flag is off', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(false);

    const { container } = render(<LandingPassPrices />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the live Day Pass and Semester Pass prices when the flag is on', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);

    render(<LandingPassPrices />);

    const dayPass = screen.getByText(/Day Pass/);
    expect(dayPass).toHaveTextContent('$6');
    expect(dayPass).toHaveTextContent('no account');
    expect(screen.getByText(/Semester Pass/)).toHaveTextContent('$29');
  });

  it('renders the German copy when the UI language is German', async () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    await i18n.changeLanguage('de');

    render(<LandingPassPrices />);

    expect(screen.getByText(/Day Pass/)).toHaveTextContent('$6');
    expect(screen.getByText(/Semester Pass/)).toHaveTextContent('$29');
  });
});
