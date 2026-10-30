import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PassCards } from './PassCards';

type Overrides = Partial<Parameters<typeof PassCards>[0]>;

const TITLES = ['Day Pass', 'Week Pass', 'Semester Pass'];

function renderPassCards(overrides: Overrides = {}) {
  render(
    <PassCards
      onDayPass={vi.fn()}
      onWeekPass={vi.fn()}
      onSemesterPass={vi.fn()}
      dayPassPending={false}
      weekPassPending={false}
      {...overrides}
    />
  );
}

function featuredTitles(): string[] {
  return TITLES.filter((title) =>
    screen
      .getByRole('heading', { name: title })
      .parentElement?.parentElement?.className.includes('cardPro')
  );
}

describe('PassCards featuring', () => {
  it.each<[string, Overrides, string[]]>([
    ['the limit wall', { featureDayPass: true }, ['Day Pass']],
    [
      'the limit wall in its semester arm',
      { featureDayPass: false, featureSemester: true },
      ['Semester Pass'],
    ],
    [
      'the pricing page and preview page',
      { featureDayPass: false, featureSemester: true, benefits: [] },
      ['Semester Pass'],
    ],
    ['no featured pass', { featureDayPass: false }, []],
  ])('features only the expected card on %s', (_label, overrides, expected) => {
    renderPassCards(overrides);
    expect(featuredTitles()).toEqual(expected);
  });

  it.each(['One study day', 'One exam week'])(
    'hides the %s caption when the Day Pass is featured',
    (caption) => {
      renderPassCards({ featureDayPass: true });
      expect(screen.queryByText(caption)).not.toBeInTheDocument();
    }
  );

  it('keeps the Semester horizon caption when the Day Pass is featured', () => {
    renderPassCards({ featureDayPass: true });
    expect(screen.getByText('A full term')).toBeInTheDocument();
  });
});
