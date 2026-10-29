import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES } from '../../../lib/i18n';
import { PassCards } from './PassCards';

type Overrides = Partial<Parameters<typeof PassCards>[0]>;

function cardByTitle(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const card = heading.closest('div')?.parentElement;
  if (card == null) throw new Error(`card for ${title} not found`);
  return card;
}

function renderPassCards(overrides: Overrides = {}) {
  const props = {
    onDayPass: vi.fn(),
    onWeekPass: vi.fn(),
    onSemesterPass: vi.fn(),
    dayPassPending: false,
    weekPassPending: false,
    semesterPassPending: false,
    ...overrides,
  };
  return { props, ...render(<PassCards {...props} />) };
}

describe('PassCards', () => {
  it('renders Day, Week, and Semester Pass cards side by side', () => {
    renderPassCards();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass · $6' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass · $12' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Semester Pass · $29' })
    ).toBeInTheDocument();
  });

  it('omits the Semester Pass card when onSemesterPass is not provided', () => {
    renderPassCards({ onSemesterPass: undefined });
    expect(
      screen.queryByRole('button', { name: 'Get Semester Pass · $29' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('No subscription').length).toBe(2);
  });

  it('does not hide the pass cards behind an accordion', () => {
    const { container } = renderPassCards();
    expect(container.querySelector('details')).toBeNull();
  });

  it('shows the No subscription benefit on each of the three cards', () => {
    renderPassCards();
    expect(screen.getAllByText('No subscription').length).toBe(3);
  });

  it('does not list No ads — the whole product is ad-free', () => {
    renderPassCards();
    expect(screen.queryByText('No ads')).not.toBeInTheDocument();
  });

  it('calls onDayPass when Get Day Pass is clicked', () => {
    const onDayPass = vi.fn();
    renderPassCards({ onDayPass });
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass · $6' }));
    expect(onDayPass).toHaveBeenCalledOnce();
  });

  it('calls onWeekPass when Get Week Pass is clicked', () => {
    const onWeekPass = vi.fn();
    renderPassCards({ onWeekPass });
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Week Pass · $12' })
    );
    expect(onWeekPass).toHaveBeenCalledOnce();
  });

  it('calls onSemesterPass when Get Semester Pass is clicked', () => {
    const onSemesterPass = vi.fn();
    renderPassCards({ onSemesterPass });
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Semester Pass · $29' })
    );
    expect(onSemesterPass).toHaveBeenCalledOnce();
  });

  it('disables the Day Pass button when dayPassPending', () => {
    renderPassCards({ dayPassPending: true });
    expect(
      screen.getAllByRole('button', { name: 'Starting checkout' })[0]
    ).toBeDisabled();
  });

  it('disables the Semester Pass button when semesterPassPending', () => {
    renderPassCards({ semesterPassPending: true });
    expect(
      screen.getByRole('button', { name: 'Starting checkout' })
    ).toBeDisabled();
  });

  it('renders correct pricing for each pass', () => {
    renderPassCards();
    expect(screen.getByText('$6')).toBeInTheDocument();
    expect(screen.getByText('$12')).toBeInTheDocument();
    expect(screen.getByText('$29')).toBeInTheDocument();
  });

  it.each([
    ['the limit wall', { featureDayPass: true }],
    [
      'the pricing page and pass-first wall',
      { featureDayPass: false, featureSemester: true },
    ],
    ['no featured pass', { featureDayPass: false, featureSemester: false }],
  ])(
    'marks the Day Pass Most popular and the Semester Pass Best value on %s',
    (_label, overrides) => {
      renderPassCards(overrides);
      expect(
        within(cardByTitle('Day Pass')).getByText('Most popular')
      ).toBeInTheDocument();
      expect(
        within(cardByTitle('Semester Pass')).getByText('Best value')
      ).toBeInTheDocument();
      expect(screen.getAllByText('Most popular')).toHaveLength(1);
      expect(screen.getAllByText('Best value')).toHaveLength(1);
      expect(
        within(cardByTitle('Week Pass')).queryByText(/Most popular|Best value/)
      ).toBeNull();
    }
  );

  it('lists no benefits on the cards when given an empty list', () => {
    renderPassCards({ benefits: [] });
    expect(screen.queryByText('No subscription')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlimited cards')).not.toBeInTheDocument();
  });

  it('captions each pass with its study horizon on the pricing page', () => {
    renderPassCards({ featureDayPass: false });
    expect(screen.getByText('One study day')).toBeInTheDocument();
    expect(screen.getByText('One exam week')).toBeInTheDocument();
    expect(screen.getByText('A full term')).toBeInTheDocument();
  });

  it('leads with the Semester Pass when featureSemester is set, without moving the badges', () => {
    renderPassCards({ featureDayPass: false, featureSemester: true });
    const titles = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(['Semester Pass', 'Week Pass', 'Day Pass']);
    expect(
      within(cardByTitle('Semester Pass')).queryByText('Most popular')
    ).toBeNull();
  });

  it('keeps the study-horizon and per-week captions when the Semester Pass leads', () => {
    renderPassCards({ featureDayPass: false, featureSemester: true });
    expect(screen.getByText('A full term')).toBeInTheDocument();
    expect(screen.getByText('One exam week')).toBeInTheDocument();
    expect(screen.getByText('One study day')).toBeInTheDocument();
    expect(
      within(cardByTitle('Semester Pass')).getByText(
        '85% less per week than the Week Pass'
      )
    ).toBeInTheDocument();
  });

  it('shows the per-week value line under the Semester Pass', () => {
    renderPassCards({ featureDayPass: false });
    expect(
      within(cardByTitle('Semester Pass')).getByText(
        '85% less per week than the Week Pass'
      )
    ).toBeInTheDocument();
  });
});

describe.each(SUPPORTED_LANGUAGES)('PassCards in %s', (language) => {
  beforeEach(async () => {
    await i18n.changeLanguage(language);
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('labels a pending pass with a sentence, not a loading ellipsis', () => {
    renderPassCards({ semesterPassPending: true });
    const pending = screen.getByRole('button', {
      name: i18n.t('pricing.pass.startingCheckout'),
    });
    expect(pending).toBeDisabled();
    expect(pending.textContent).not.toMatch(/…|\.\.\./);
  });

  it('names each pass and its live price on its button', () => {
    renderPassCards({ prices: { '24h': '€6', '7d': '€12', '120d': '€29' } });
    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(buttons).toHaveLength(3);
    for (const [label, price] of [
      ['Day Pass', '€6'],
      ['Week Pass', '€12'],
      ['Semester Pass', '€29'],
    ]) {
      expect(buttons.filter((text) => text.includes(label))).toEqual([
        expect.stringContaining(price),
      ]);
    }
    if (language !== 'en') {
      expect(buttons.some((text) => text.startsWith('Get '))).toBe(false);
    }
  });

  it('keeps a hardcoded currency out of the Semester Pass value line', () => {
    renderPassCards({ featureDayPass: false });
    const caption = within(cardByTitle('Semester Pass')).getByText(
      i18n.t('pricing.pass.semesterPerWeek')
    );
    expect(caption.textContent).not.toMatch(/[$€£]/);
  });
});
