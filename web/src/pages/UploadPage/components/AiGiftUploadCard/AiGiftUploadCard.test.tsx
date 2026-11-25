import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AiGiftUploadCard, type HoldChosenFiles } from './AiGiftUploadCard';
import { getAiGift, type AiGiftStatus } from '../../../../lib/backend/aiGift';
import { track } from '../../../../lib/analytics/track';
import {
  createHeldGiftFileStore,
  createMemoryHeldGiftFileStore,
  memoryRecords,
  type HeldGiftFileStore,
} from '../../../../lib/aiGift/heldGiftFile';
import { readGiftHandoff } from '../../../../lib/aiGift/giftHandoff';
import { takeGiftSignupOrigin } from '../../../../lib/aiGift/giftSignupOrigin';
import { reportUploadZoneActivity } from '../../../../lib/upload/uploadZoneActivity';
import i18n from '../../../../lib/i18n';
import { SUPPORTED_LANGUAGES } from '../../../../lib/i18n';
import styles from './AiGiftUploadCard.module.css';
import cardCss from './AiGiftUploadCard.module.css?raw';

vi.mock('../../../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../../../lib/backend/aiGift', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/backend/aiGift')>()),
  getAiGift: vi.fn(),
}));

const TERMS = {
  credits: 100,
  validDays: 7,
  endsAt: '2026-12-04T22:00:00.000Z',
  feedbackDue: false,
  minMonthlyCards: 20,
};
const OPEN_SIGNED_OUT: AiGiftStatus = {
  state: 'open',
  hasCredits: false,
  ...TERMS,
};
const OPEN_SIGNED_IN: AiGiftStatus = {
  state: 'open',
  hasCredits: true,
  nextUploadUsesCredits: true,
  switchOnByDefault: true,
  monthlyCardsLeft: 90,
  ...TERMS,
};
const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

let handedOff: unknown = null;
let heldFiles: HeldGiftFileStore;

function LocationProbe() {
  const location = useLocation();
  handedOff = location.state;
  return null;
}

let hold: HoldChosenFiles | undefined;

function renderCard(signedIn: boolean | undefined) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <AiGiftUploadCard signedIn={signedIn} heldFiles={heldFiles}>
                  {(holdChosenFiles) => {
                    hold = holdChosenFiles;
                    return <div data-testid="upload-form">the upload form</div>;
                  }}
                </AiGiftUploadCard>
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function file(name: string, size = 400) {
  return new File([new Uint8Array(size)], name);
}

function dropOn(target: Element, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files, items: [] } });
}

function eventsNamed(name: string) {
  return vi.mocked(track).mock.calls.filter(([event]) => event === name);
}

const chooseAi = () =>
  fireEvent.click(screen.getByRole('button', { name: /AI from notes/ }));
const chooseNotion = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Notion export' }));

beforeEach(() => {
  vi.mocked(track).mockClear();
  vi.mocked(getAiGift).mockReset();
  heldFiles = createMemoryHeldGiftFileStore();
  handedOff = null;
  hold = undefined;
  globalThis.sessionStorage.clear();
  globalThis.localStorage.clear();
  reportUploadZoneActivity('idle');
});

afterEach(() => {
  reportUploadZoneActivity('absent');
});

describe('the upload card with the gift off or not for this account', () => {
  it.each<[string, AiGiftStatus, boolean]>([
    ['the gift is off or ended', CLOSED, false],
    ['the gift total is full', { state: 'full', feedbackDue: false }, false],
    ['a signed-in account has no credits', CLOSED, true],
    [
      'a signed-in grant is used up',
      {
        state: 'claimed',
        ...TERMS,
        credits: 0,
        hasCredits: false,
        expiresAt: '2026-12-02T12:00:00.000Z',
        firstUsed: true,
      },
      true,
    ],
  ])(
    'shows the upload form exactly as before when %s',
    async (_case, status, signedIn) => {
      vi.mocked(getAiGift).mockResolvedValue(status);
      renderCard(signedIn);

      await waitFor(() => expect(getAiGift).toHaveBeenCalled());
      expect(screen.getByTestId('upload-form')).toBeVisible();
      expect(screen.queryByRole('group')).toBeNull();
      expect(screen.queryByText(/Free account needed/)).toBeNull();
      expect(hold).toBeUndefined();
      expect(eventsNamed('upload_card_viewed')).toEqual([]);
    }
  );

  it('shows a signed-out visitor no AI mode, Free pill or sign-up when the server answers full for their network', async () => {
    vi.mocked(getAiGift).mockResolvedValue({
      state: 'full',
      feedbackDue: false,
    });
    renderCard(false);

    await waitFor(() => expect(getAiGift).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /AI from notes/ })).toBeNull();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.getByTestId('upload-form')).toBeVisible();
  });

  it('waits for the session before offering anything', async () => {
    vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_OUT);
    renderCard(undefined);

    await waitFor(() => expect(getAiGift).toHaveBeenCalled());
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByTestId('upload-form')).toBeVisible();
  });
});

describe('the upload card for a signed-out pass holder', () => {
  it('offers no free account and no sign-up to someone who already paid with a pass', async () => {
    globalThis.localStorage.setItem('2anki_pass_token', 'cs_pass');
    vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_OUT);
    renderCard(false);

    await waitFor(() => expect(getAiGift).toHaveBeenCalled());
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText(/Free account needed/)).toBeNull();
    expect(screen.getByTestId('upload-form')).toBeVisible();
    expect(hold).toBeUndefined();
  });
});

describe('the upload card for a signed-out visitor', () => {
  beforeEach(() => {
    vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_OUT);
  });

  it('shows Notion export first, with the form, a Free pill on the AI segment and the footnote', async () => {
    renderCard(false);

    const notion = await screen.findByRole('button', {
      name: 'Notion export',
    });
    expect(notion).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: /AI from notes/ })
    ).toHaveTextContent('Free');
    expect(screen.getByTestId('upload-form')).toBeVisible();
    expect(
      screen.getByText('Free account needed · 100 credits, about 3 decks')
    ).toBeInTheDocument();
    expect(eventsNamed('upload_card_viewed')).toEqual([
      ['upload_card_viewed', { surface: 'upload_card', signed_in: false }],
    ]);
  });

  it('swaps in the AI dropzone with its one Choose file button', async () => {
    renderCard(false);
    await screen.findByRole('group');

    chooseAi();

    expect(screen.getByText('Drop a PDF, photo or notes')).toBeInTheDocument();
    expect(screen.getByText('Claude writes the cards')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Choose file' })).toHaveLength(
      1
    );
    expect(screen.getByTestId('upload-form')).not.toBeVisible();
  });

  it('records choosing the AI mode once per page view, however often it is chosen', async () => {
    renderCard(false);
    await screen.findByRole('group');

    chooseAi();
    chooseNotion();
    chooseAi();

    expect(eventsNamed('ai_mode_selected')).toEqual([
      ['ai_mode_selected', { surface: 'upload_card', signed_in: false }],
    ]);
  });

  it('marks the dropzone while a file is dragged over it, and clears it on leave', async () => {
    renderCard(false);
    await screen.findByRole('group');
    chooseAi();
    const zone = screen.getByTestId('ai-notes-dropzone');

    fireEvent.dragEnter(zone);
    expect(zone).toHaveClass(styles.dropzoneOver);

    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass(styles.dropzoneOver);
  });

  it.each(['lecture.pdf', 'board.jpg', 'notes.txt', 'notes.md', 'export.zip'])(
    'keeps %s as a row and puts the sign-up in the same card',
    async (name) => {
      renderCard(false);
      await screen.findByRole('group');
      chooseAi();

      dropOn(screen.getByTestId('ai-notes-dropzone'), [file(name, 2048)]);

      expect(await screen.findByText(name)).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
      expect(
        await screen.findByText(
          'Create a free account and Claude makes this deck. Your file stays right here.'
        )
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Google/ })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  );

  it('says the file cannot be kept, and never that it stays, when the browser cannot store it', async () => {
    heldFiles = createHeldGiftFileStore(memoryRecords(false));
    renderCard(false);
    await screen.findByRole('group');
    chooseAi();

    dropOn(screen.getByTestId('ai-notes-dropzone'), [file('lecture.pdf')]);

    expect(
      await screen.findByText(
        "This browser can't keep your file while you sign up. Create your account, then drop the file again."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your file stays right here/)).toBeNull();
  });

  it.each(['deck.apkg', 'cards.xml', 'book.epub'])(
    'refuses %s with a plain line and keeps the dropzone',
    async (name) => {
      renderCard(false);
      await screen.findByRole('group');
      chooseAi();

      dropOn(screen.getByTestId('ai-notes-dropzone'), [file(name)]);

      expect(
        screen.getByText(
          'Claude cards read PDFs, photos, notes and Notion zip files. Try one of those.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(name)).toBeNull();
      expect(eventsNamed('file_dropped')).toEqual([]);
    }
  );

  it('records the drop with its mode and type, never the file name', async () => {
    renderCard(false);
    await screen.findByRole('group');
    chooseAi();

    dropOn(screen.getByTestId('ai-notes-dropzone'), [file('Week 3 notes.pdf')]);

    await screen.findByText('Week 3 notes.pdf');
    expect(eventsNamed('file_dropped')).toEqual([
      [
        'file_dropped',
        {
          surface: 'upload_card',
          mode: 'ai',
          via: 'card',
          signed_in: false,
          format: 'pdf',
        },
      ],
    ]);
  });

  it.each(['Google', 'Notion', 'Microsoft', 'Apple'])(
    'tags a %s sign-up started from the card with its origin, for the funnel',
    async (provider) => {
      renderCard(false);
      await screen.findByRole('group');
      chooseAi();
      dropOn(screen.getByTestId('ai-notes-dropzone'), [file('lecture.pdf')]);

      fireEvent.click(
        await screen.findByRole('link', { name: new RegExp(provider) })
      );

      expect(eventsNamed('signup_started')).toEqual([
        [
          'signup_started',
          {
            method: provider.toLowerCase(),
            signup_origin: 'upload_card_ai',
          },
        ],
      ]);
      expect(takeGiftSignupOrigin()).toBe('upload_card_ai');
    }
  );

  it('tags an email sign-up started from the card with its origin', async () => {
    renderCard(false);
    await screen.findByRole('group');
    chooseAi();
    dropOn(screen.getByTestId('ai-notes-dropzone'), [file('lecture.pdf')]);

    fireEvent.focus(await screen.findByLabelText('Email'));

    expect(eventsNamed('signup_started')).toEqual([
      ['signup_started', { method: 'email', signup_origin: 'upload_card_ai' }],
    ]);
  });

  it('hands the file back after sign-up, so the person never picks it again', async () => {
    const first = renderCard(false);
    await screen.findByRole('group');
    chooseAi();
    dropOn(screen.getByTestId('ai-notes-dropzone'), [
      file('lecture.txt', 4096),
    ]);
    await screen.findByText('lecture.txt');
    await screen.findByText(/Your file stays right here/);
    first.unmount();

    vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_IN);
    renderCard(true);

    expect(await screen.findByText('lecture.txt')).toBeInTheDocument();
    expect(
      await screen.findByRole('switch', {
        name: 'Improve with Claude (uses credits)',
      })
    ).toBeChecked();
  });

  it.each<[string, AiGiftStatus]>([
    ['a paying or expired account', CLOSED],
    ['a full gift total or network', { state: 'full', feedbackDue: false }],
  ])(
    'shows the kept file with why the credits do not apply, and converts it only on a click, after sign-in to %s',
    async (_case, status) => {
      const kept = file('lecture.pdf');
      const first = renderCard(false);
      await screen.findByRole('group');
      chooseAi();
      dropOn(screen.getByTestId('ai-notes-dropzone'), [kept]);
      await screen.findByText(/Your file stays right here/);
      first.unmount();

      vi.mocked(getAiGift).mockResolvedValue(status);
      renderCard(true);

      expect(
        await screen.findByText(
          'Free AI credits are not available for this upload, so it will be converted the usual way.'
        )
      ).toBeInTheDocument();
      expect(screen.getByText('lecture.pdf')).toBeInTheDocument();
      expect(readGiftHandoff(handedOff)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Convert' }));

      await waitFor(() =>
        expect(readGiftHandoff(handedOff)).toEqual({
          files: [kept],
          claude: null,
        })
      );
    }
  );

  it('forgets a removed file, so it does not come back after sign-up, and forgets the card origin', async () => {
    const first = renderCard(false);
    await screen.findByRole('group');
    chooseAi();
    dropOn(screen.getByTestId('ai-notes-dropzone'), [file('lecture.pdf')]);
    await screen.findByText(/Your file stays right here/);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('lecture.pdf')).toBeNull());
    first.unmount();
    vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_IN);
    renderCard(true);

    await screen.findByRole('group');
    expect(screen.queryByText('lecture.pdf')).toBeNull();
    expect(takeGiftSignupOrigin()).toBeNull();
  });

  it('deletes an expired kept file on a visit that never signs in', async () => {
    let now = 0;
    const records = memoryRecords(true);
    heldFiles = createHeldGiftFileStore(records, () => now);
    await heldFiles.save([file('lecture.pdf')]);
    now = 61 * 60 * 1000;

    renderCard(false);

    await waitFor(async () => expect(await records.get()).toBeNull());
  });

  it('leaves files in Notion export mode to the upload form', async () => {
    renderCard(false);
    await screen.findByRole('group');

    expect(hold?.([file('export.zip')])).toBe(false);
  });
});

describe('the convert step for an account with gift credits', () => {
  beforeEach(() => {
    vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_IN);
  });

  async function dropInAiMode(files: File[]) {
    renderCard(true);
    await screen.findByRole('group');
    chooseAi();
    dropOn(screen.getByTestId('ai-notes-dropzone'), files);
  }

  it('shows the switch on by default with the cost and the stop line before converting', async () => {
    await dropInAiMode([file('notes.txt', 60_000)]);

    expect(
      await screen.findByRole('switch', {
        name: 'Improve with Claude (uses credits)',
      })
    ).toBeChecked();
    expect(
      screen.getByText(
        'About 20 credits, 100 left. Claude stops when your credits run out.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Make my deck' })
    ).toHaveLength(1);
    expect(eventsNamed('ai_toggle_shown')).toEqual([
      [
        'ai_toggle_shown',
        expect.objectContaining({
          surface: 'upload_card',
          on: true,
          estimate: 20,
          fits: true,
          format: 'txt',
        }),
      ],
    ]);
  });

  it('shows no number for a PDF, only what is left and that Claude stops', async () => {
    await dropInAiMode([file('scan.pdf', 2_000_000)]);

    expect(
      await screen.findByText(
        '100 credits left. Claude stops when your credits run out.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('says when the cost is more than is left and starts with the switch off', async () => {
    await dropInAiMode([file('notes.txt', 600_000)]);

    expect(
      await screen.findByText(
        'About 180 credits, more than the 100 you have left. Claude stops when your credits run out.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('starts with the switch off when the server says the account chose against Claude', async () => {
    vi.mocked(getAiGift).mockResolvedValue({
      ...OPEN_SIGNED_IN,
      switchOnByDefault: false,
    });
    await dropInAiMode([file('lecture.txt')]);

    expect(await screen.findByRole('switch')).not.toBeChecked();
  });

  it('hands the files and the switch value to the upload form, recording no choice for a switch left as it was', async () => {
    const notes = file('notes.txt');
    await dropInAiMode([notes]);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Make my deck' })
    );

    await waitFor(() =>
      expect(readGiftHandoff(handedOff)).toEqual({
        files: [notes],
        claude: true,
      })
    );
    expect(globalThis.localStorage.getItem('ai-choice-at')).toBeNull();
    expect(eventsNamed('ai_toggle_on')).toEqual([
      ['ai_toggle_on', { surface: 'upload_card', changed: false }],
    ]);
  });

  it('records a switch turned off as the person’s own choice', async () => {
    await dropInAiMode([file('notes.txt')]);
    fireEvent.click(await screen.findByRole('switch'));

    fireEvent.click(screen.getByRole('button', { name: 'Make my deck' }));

    await waitFor(() => expect(readGiftHandoff(handedOff)?.claude).toBe(false));
    expect(globalThis.localStorage.getItem('ai-choice-at')).toMatch(/^\d+$/);
    expect(eventsNamed('upload_ai_turned_off')).toEqual([
      ['upload_ai_turned_off', { surface: 'convert_step' }],
    ]);
  });

  it('sends a photo straight on to Photo to Deck, with no switch', async () => {
    const photo = file('board.jpg');
    await dropInAiMode([photo]);

    await waitFor(() =>
      expect(readGiftHandoff(handedOff)).toEqual({
        files: [photo],
        claude: null,
      })
    );
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the switch for a Notion zip chosen through the form, and leaves an Anki deck to the form', async () => {
    renderCard(true);
    await screen.findByRole('group');

    expect(hold?.([file('deck.apkg')])).toBe(false);
    let taken = false;
    act(() => {
      taken = hold?.([file('export.zip', 1_000)]) ?? false;
    });

    expect(taken).toBe(true);
    expect(screen.getByText('export.zip')).toBeInTheDocument();
  });

  it('says how many free credits are left under the card, with no deck count', async () => {
    renderCard(true);

    expect(
      await screen.findByText('100 free credits left')
    ).toBeInTheDocument();
  });

  it('shows the honest line and no switch when the month has too few cards for the gift', async () => {
    vi.mocked(getAiGift).mockResolvedValue({
      ...OPEN_SIGNED_IN,
      nextUploadUsesCredits: false,
      switchOnByDefault: false,
      monthlyCardsLeft: 12,
    });
    renderCard(true);

    expect(
      await screen.findByText(
        'You have 12 cards left this month, too few for a Claude deck. Your next file gets cards from its structure.'
      )
    ).toBeInTheDocument();
    expect(hold?.([file('notes.txt')])).toBe(false);
  });

  it('says a conversion is using the credits while one runs', async () => {
    vi.mocked(getAiGift).mockResolvedValue({
      state: 'claimed',
      ...TERMS,
      hasCredits: true,
      expiresAt: '2026-12-02T12:00:00.000Z',
      firstUsed: true,
      inUse: true,
      nextUploadUsesCredits: false,
      switchOnByDefault: false,
      monthlyCardsLeft: 90,
    });
    renderCard(true);

    expect(
      await screen.findByText(
        'A conversion is using your free AI credits right now.'
      )
    ).toBeInTheDocument();
  });

  it('shows the form, not the dropzone, while it has a result or a conversion to show', async () => {
    renderCard(true);
    await screen.findByRole('group');
    chooseAi();

    act(() => reportUploadZoneActivity('busy'));

    expect(screen.getByTestId('upload-form')).toBeVisible();
    expect(screen.queryByTestId('ai-notes-dropzone')).toBeNull();
  });
});

describe('the upload card on a narrow screen', () => {
  const narrow = cardCss.slice(cardCss.indexOf('@media (max-width: 480px)'));

  it('stretches the switch across and leaves the dropzone as its Choose file button', () => {
    expect(narrow).toMatch(/\.modeSwitch\s*{\s*align-self: stretch;/);
    expect(narrow).toMatch(
      /\.dropIcon,\s*\.dropTitle,\s*\.dropBody\s*{\s*display: none;/
    );
    expect(narrow).toMatch(/\.dropzone \.chooseButton\s*{\s*width: 100%;/);
  });

  it('keeps each segment label on one line at phone width', () => {
    expect(cardCss).toMatch(/\.modeOption\s*{[^}]*white-space: nowrap;/);
    expect(narrow).toMatch(
      /\.modeOption\s*{[^}]*padding: var\(--space-1\) var\(--space-2\);[^}]*font-size: var\(--text-xs\);/
    );
  });
});

describe('the upload card in every language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([...SUPPORTED_LANGUAGES])(
    'has every string of the card and the convert step in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      vi.mocked(getAiGift).mockResolvedValue(OPEN_SIGNED_IN);
      renderCard(true);
      await screen.findByRole('group');
      fireEvent.click(screen.getAllByRole('button')[1]);
      dropOn(screen.getByTestId('ai-notes-dropzone'), [file('notes.txt')]);
      await screen.findByRole('switch');

      expect(document.body.textContent).not.toMatch(
        /card\.|convert\.|pill\.|\{\{/
      );
    }
  );
});
