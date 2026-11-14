import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../lib/i18n';
import { LandingPassPrices } from './LandingPassPrices';

vi.mock('../../lib/hooks/useLandingPassPrices', () => ({
  useLandingPassPricesEnabled: vi.fn(),
  useLandingPassPricesPending: vi.fn(),
}));

vi.mock('../../lib/hooks/usePassPrices', () => ({
  useLivePassPrices: vi.fn(),
  useLivePassPricesPending: vi.fn(),
}));

import {
  useLandingPassPricesEnabled,
  useLandingPassPricesPending,
} from '../../lib/hooks/useLandingPassPrices';
import {
  useLivePassPrices,
  useLivePassPricesPending,
} from '../../lib/hooks/usePassPrices';

const liveBoth = { '24h': '$6', '7d': '$12', '120d': '$29' };

describe('LandingPassPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLandingPassPricesPending).mockReturnValue(false);
    vi.mocked(useLivePassPricesPending).mockReturnValue(false);
  });

  it("holds the block's space while the flag is still loading", () => {
    vi.mocked(useLandingPassPricesPending).mockReturnValue(true);
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(false);
    vi.mocked(useLivePassPrices).mockReturnValue({});

    render(<LandingPassPrices />);

    expect(screen.getByTestId('landing-pass-prices-reserved')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it("holds the block's space while the flag is on and prices are loading", () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPricesPending).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue({});

    render(<LandingPassPrices />);

    expect(
      screen.getByTestId('landing-pass-prices-reserved')
    ).toBeInTheDocument();
  });

  it('holds no space once the flag has loaded off, even with prices pending', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(false);
    vi.mocked(useLivePassPricesPending).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue({});

    const { container } = render(<LandingPassPrices />);

    expect(container).toBeEmptyDOMElement();
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing while the flag is off', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(false);
    vi.mocked(useLivePassPrices).mockReturnValue(liveBoth);

    const { container } = render(<LandingPassPrices />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the live prices failed to load', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue({});

    const { container } = render(<LandingPassPrices />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the Semester Pass price is missing', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue({ '24h': '$6' });

    const { container } = render(<LandingPassPrices />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the Day Pass price is missing', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue({ '120d': '$29' });

    const { container } = render(<LandingPassPrices />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the live Day Pass and Semester Pass prices when the flag is on and both are live', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue(liveBoth);

    render(<LandingPassPrices />);

    const dayPass = screen.getByText(/Day Pass/);
    expect(dayPass).toHaveTextContent('$6');
    expect(dayPass).toHaveTextContent('no account');
    expect(screen.getByText(/Semester Pass/)).toHaveTextContent('$29');
  });

  it('labels the region by its heading', () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue(liveBoth);

    render(<LandingPassPrices />);

    expect(
      screen.getByRole('complementary', {
        name: /Need more than the free limit/,
      })
    ).toBeInTheDocument();
  });

  it('renders the German copy when the UI language is German', async () => {
    vi.mocked(useLandingPassPricesEnabled).mockReturnValue(true);
    vi.mocked(useLivePassPrices).mockReturnValue(liveBoth);
    await i18n.changeLanguage('de');

    render(<LandingPassPrices />);

    expect(screen.getByText(/ohne Konto/)).toBeInTheDocument();
  });
});
