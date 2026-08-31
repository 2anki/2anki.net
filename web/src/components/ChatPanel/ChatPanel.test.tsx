import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatPanel, { consumeSseEvents } from './ChatPanel';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));

import { useUserLocals } from '../../lib/hooks/useUserLocals';

type UserLocalsReturn = ReturnType<typeof useUserLocals>;

const mockUseUserLocals = vi.mocked(useUserLocals);

const makeLocals = (
  chat_consent_at: string | null,
  subscriber = true
): UserLocalsReturn => ({
  data: {
    locals: {
      owner: 1,
      patreon: false,
      subscriber,
      subscriptionInfo: { active: subscriber, email: '', linked_email: '' },
    },
    linked_email: '',
    user: {
      id: 1 as import('../../schemas/public/Users').UsersId,
      name: 'Test User',
      email: 'test@example.com',
      password: '',
      created_at: null,
      updated_at: null,
      reset_token: null,
      patreon: false,
      chat_consent_at,
    },
  },
  isLoading: false,
  error: null,
  isError: false,
  refetch: vi.fn(),
});

const consentedLocals = makeLocals('2026-01-01T00:00:00.000Z');
const unconsentedLocals = makeLocals(null);
const freeUserLocals = makeLocals('2026-01-01T00:00:00.000Z', false);

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../lib/backend/api', () => ({
  post: vi.fn(),
  postMultipart: vi.fn(),
  get: vi.fn().mockResolvedValue({}),
  patch: vi.fn(),
  del: vi.fn(),
}));

import { get, patch, post, postMultipart } from '../../lib/backend/api';
import { track } from '../../lib/analytics/track';

const mockTrack = track as ReturnType<typeof vi.fn>;

const mockPost = post as ReturnType<typeof vi.fn>;
const mockGet = get as ReturnType<typeof vi.fn>;
const mockPatch = patch as ReturnType<typeof vi.fn>;
const mockPostMultipart = postMultipart as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockUseUserLocals.mockReturnValue(consentedLocals);
});

function makeSseResponse(events: Array<{ event: string; data: unknown }>) {
  const encoder = new TextEncoder();
  const chunks = events.map(({ event, data }) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  );
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream };
}

function renderChatPanel(props: React.ComponentProps<typeof ChatPanel> = {}) {
  return render(
    <MemoryRouter>
      <ChatPanel {...props} />
    </MemoryRouter>
  );
}

describe('ChatPanel — empty state', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('renders heading "What are you studying?" when no messages', () => {
    renderChatPanel();
    expect(
      screen.getByRole('heading', { name: 'What are you studying?' })
    ).toBeInTheDocument();
  });

  it('renders the composer pill in the empty state', () => {
    renderChatPanel();
    expect(
      screen.getByRole('textbox', { name: 'Message input' })
    ).toBeInTheDocument();
  });

  it('does not render starter chip buttons', () => {
    renderChatPanel();
    expect(
      screen.queryByRole('button', { name: 'Make cards from a topic' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Explain this concept' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Quiz me' })
    ).not.toBeInTheDocument();
  });

  it('does not render a descriptive sub-line below the heading', () => {
    renderChatPanel();
    expect(
      screen.queryByText(
        'Ask a question, paste your notes, or attach a PDF — get flashcards back.'
      )
    ).not.toBeInTheDocument();
  });
});

describe('ChatPanel — send button state', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('send button is disabled when input is empty', () => {
    renderChatPanel();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('send button is enabled when input has content', () => {
    renderChatPanel();
    const textarea = screen.getByRole('textbox', { name: 'Message input' });
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(
      screen.getByRole('button', { name: 'Send message' })
    ).not.toBeDisabled();
  });
});

describe('ChatPanel — user message layout', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('renders user message with aria-label "User message"', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Answer', conversationId: 1 } },
      ])
    );
    renderChatPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'My question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(screen.getByLabelText('User message')).toBeInTheDocument();
    });
  });
});

describe('ChatPanel — long user message collapse', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('shows "Show full message" toggle for long messages', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Short reply', conversationId: 1 } },
      ])
    );
    const longMessage = 'A'.repeat(700);
    renderChatPanel({
      initialMessages: [{ role: 'user', content: longMessage }],
    });
    expect(
      screen.getByRole('button', { name: 'Show full message' })
    ).toBeInTheDocument();
  });

  it('toggles to "Show less" after clicking "Show full message"', () => {
    const longMessage = 'B'.repeat(700);
    renderChatPanel({
      initialMessages: [{ role: 'user', content: longMessage }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show full message' }));
    expect(
      screen.getByRole('button', { name: 'Show less' })
    ).toBeInTheDocument();
  });
});

describe('ChatPanel — assistant message layout', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('renders assistant prose without a user-message aria-label', async () => {
    renderChatPanel({
      initialMessages: [{ role: 'assistant', content: 'The answer is 42.' }],
    });
    expect(screen.getByText('The answer is 42.')).toBeInTheDocument();
    expect(screen.queryByLabelText('User message')).not.toBeInTheDocument();
  });
});

describe('ChatPanel — CardPreview integration', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('renders "Download deck" button when message has cards', () => {
    renderChatPanel({
      initialMessages: [
        {
          role: 'assistant',
          content: '',
          cards: [{ front: 'Q1', back: 'A1' }],
        },
      ],
    });
    expect(
      screen.getByRole('button', { name: 'Download deck' })
    ).toBeInTheDocument();
  });

  it('"Download deck" button calls the deck API', async () => {
    mockPost.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    });
    renderChatPanel({
      initialMessages: [
        {
          role: 'assistant',
          content: '',
          cards: [{ front: 'Q1', back: 'A1' }],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/deck',
        expect.objectContaining({ cards: [{ front: 'Q1', back: 'A1' }] })
      );
    });
  });
});

describe('ChatPanel — per-turn deck download and naming', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    mockPatch.mockResolvedValue({ ok: true, status: 204 });
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('downloads an MCQ turn as mcq even when the selector defaults to Basic', async () => {
    mockPost.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    });
    renderChatPanel({
      initialMessages: [
        {
          role: 'assistant',
          content: '',
          cards: [
            {
              front: 'Which enzyme hydrolyses starch?',
              back: '',
              options: ['Lipase', 'Amylase', 'Protease', 'Lactase'],
              correctIndex: 1,
            },
          ],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/deck',
        expect.objectContaining({ templateSlug: 'mcq' })
      );
    });
  });

  it('prefills the deck name from a Deck: line in the assistant message', () => {
    renderChatPanel({
      initialMessages: [
        {
          role: 'assistant',
          content: '',
          contentBefore: 'Deck: Japanese — Time Words',
          cards: [{ front: 'Q1', back: 'A1' }],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
    const input = screen.getByRole('textbox', {
      name: 'Deck name',
    }) as HTMLInputElement;
    expect(input.value).toBe('Japanese — Time Words');
  });

  it('falls back to the conversation title when there is no Deck line', () => {
    renderChatPanel({
      initialMessages: [
        {
          role: 'assistant',
          content: '',
          contentBefore: 'Here are your cards.',
          cards: [{ front: 'Q1', back: 'A1' }],
        },
      ],
      initialTitle: 'Cell Biology chat',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download deck' }));
    const input = screen.getByRole('textbox', {
      name: 'Deck name',
    }) as HTMLInputElement;
    expect(input.value).toBe('Cell Biology chat');
  });
});

describe('ChatPanel — reselecting the current note type', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    mockPatch.mockResolvedValue({ ok: true, status: 204 });
  });

  it('regenerates when the reselected note type does not match the current cards', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Reply',
            conversationId: 7,
            cards: [{ front: 'The capital is {{c1::Oslo}}', back: '' }],
          },
        },
      ])
    );
    renderChatPanel({
      initialMessages: [
        { role: 'user', content: 'furigana deck' },
        {
          role: 'assistant',
          content: 'Reply',
          cards: [{ front: 'Capital?', back: 'Oslo' }],
        },
      ],
      initialTemplateSlug: 'cloze',
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/conversations/7/regenerate',
        { templateSlug: 'cloze' }
      );
    });
  });

  it('does not regenerate when the reselected note type already matches the cards', () => {
    renderChatPanel({
      initialMessages: [
        { role: 'user', content: 'cloze deck' },
        {
          role: 'assistant',
          content: 'Reply',
          cards: [{ front: 'The capital is {{c1::Oslo}}', back: '' }],
        },
      ],
      initialTemplateSlug: 'cloze',
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Cloze' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('ChatPanel — add tags feedback', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  const taggableMessages = [
    {
      role: 'assistant' as const,
      content: '',
      cards: [
        { front: 'Q1', back: 'A1' },
        { front: 'Q2', back: 'A2' },
      ],
    },
  ];

  it('shows "Tags added to N cards" after a successful tag add', async () => {
    mockPost.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tags: [['anatomy'], ['anatomy']] }),
    });
    renderChatPanel({ initialMessages: taggableMessages });

    fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/tag-cards',
        expect.objectContaining({
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
        })
      );
    });
    expect(
      await screen.findByText('Tags added to 2 cards')
    ).toBeInTheDocument();
  });

  it('does not show the success message when the tag add fails', async () => {
    mockPost.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    renderChatPanel({ initialMessages: taggableMessages });

    fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));

    expect(
      await screen.findByText("Couldn't add tags. Try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Tags added to/)).not.toBeInTheDocument();
  });
});

describe('ChatPanel — aria-live', () => {
  it('message list container has aria-live="polite"', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Hello', conversationId: 1 } },
      ])
    );
    renderChatPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Hi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).not.toBeNull();
    });
  });
});

describe('ChatPanel — error announcements', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('announces a send failure to screen readers via role="alert"', async () => {
    mockPost.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);
    renderChatPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'What went wrong?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't send this message. Try again."
      );
    });
  });

  it('announces an attachment-type rejection via role="alert"', async () => {
    renderChatPanel();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const badFile = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [badFile] });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Only PDF and image files work here.'
      );
    });
  });
});

describe('ChatPanel', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    mockPost.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);
  });

  it('renders with initialPrompt pre-filled in the textarea', () => {
    renderChatPanel({
      initialPrompt: 'My PDF converted but produced 0 cards.',
    });
    const textarea = screen.getByRole('textbox', {
      name: 'Message input',
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('My PDF converted but produced 0 cards.');
  });

  it('renders the message input without initialPrompt', () => {
    renderChatPanel();
    expect(
      screen.getByRole('textbox', { name: 'Message input' })
    ).toBeInTheDocument();
  });

  it('syncs the textarea when initialPrompt changes after mount', () => {
    const { rerender } = render(
      <MemoryRouter>
        <ChatPanel initialPrompt="" />
      </MemoryRouter>
    );
    const textarea = screen.getByRole('textbox', {
      name: 'Message input',
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');

    rerender(
      <MemoryRouter>
        <ChatPanel initialPrompt="Turn this into cloze cards: [paste]" />
      </MemoryRouter>
    );
    expect(textarea.value).toBe('Turn this into cloze cards: [paste]');
  });

  it('calls /api/chat/message when message is sent', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: { content: 'Here is some advice.', conversationId: 1 },
        },
      ])
    );

    renderChatPanel();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'What went wrong?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/message',
        expect.objectContaining({
          content: 'What went wrong?',
        })
      );
    });
  });

  it('handles consent_required by showing the consent modal', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([{ event: 'error', data: { type: 'consent_required' } }])
    );

    renderChatPanel();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Help me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'Chat sends your messages to Anthropic',
        })
      ).toBeInTheDocument();
    });
  });

  it('swaps to the upgrade panel when the server answers 402', async () => {
    mockPost.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({ error: 'upgrade required' }),
    });

    renderChatPanel();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Help me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(consentedLocals.refetch).toHaveBeenCalled();
    });
    expect(screen.queryByText('upgrade required')).not.toBeInTheDocument();
  });

  it('shows thinking pill with aria-label when loading with no streamed tokens yet', async () => {
    let resolveStream!: () => void;
    const neverEndingStream = new ReadableStream({
      start(controller) {
        resolveStream = () => controller.close();
      },
    });
    mockPost.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: neverEndingStream,
    });

    renderChatPanel();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'What is spaced repetition?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByRole('status', { name: 'Thinking' })
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(document.querySelector('[class*="messageSkeleton"]')).toBeNull();

    resolveStream();
  });

  it('renders streaming caret while tokens arrive and removes it after done', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'token', data: 'Hello' },
        { event: 'token', data: ' there' },
        {
          event: 'done',
          data: { content: 'Hello there.', conversationId: 42 },
        },
      ])
    );

    renderChatPanel();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Tell me something' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Hello there.')).toBeInTheDocument();
    });

    const caret = document.querySelector(
      '[aria-hidden="true"][class*="streamingCaret"]'
    );
    expect(caret).toBeNull();
  });

  it('Esc blurs the composer textarea without clearing its value', () => {
    renderChatPanel();

    const textarea = screen.getByRole('textbox', {
      name: 'Message input',
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Draft message' } });
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(document.activeElement).not.toBe(textarea);
    expect(textarea.value).toBe('Draft message');
  });

  it('Enter still sends the message after Esc handler is added', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Reply text', conversationId: 10 } },
      ])
    );

    renderChatPanel();

    const textarea = screen.getByRole('textbox', {
      name: 'Message input',
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Press enter to send' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/message',
        expect.objectContaining({
          content: 'Press enter to send',
        })
      );
    });
  });
});

describe('ChatPanel — consent modal dismissal', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    mockUseUserLocals.mockReturnValue(unconsentedLocals);
  });

  it('hides the consent modal after Not now is clicked and does not auto-reopen on re-render', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ChatPanel />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', {
        name: 'Chat sends your messages to Anthropic',
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(
      screen.queryByRole('heading', {
        name: 'Chat sends your messages to Anthropic',
      })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'some text' },
    });

    rerender(
      <MemoryRouter>
        <ChatPanel />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole('heading', {
        name: 'Chat sends your messages to Anthropic',
      })
    ).not.toBeInTheDocument();
  });

  it('re-shows the consent modal when send fails with consent_required even after Not now was clicked', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([{ event: 'error', data: { type: 'consent_required' } }])
    );

    renderChatPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(
      screen.queryByRole('heading', {
        name: 'Chat sends your messages to Anthropic',
      })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'test message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'Chat sends your messages to Anthropic',
        })
      ).toBeInTheDocument();
    });
  });
});

describe('ChatPanel — template selector', () => {
  const assistantWithCards = [
    { role: 'user' as const, content: '20 cards about Norway' },
    {
      role: 'assistant' as const,
      content: 'Reply',
      contentBefore: 'Here you go',
      cards: [
        { front: 'Capital?', back: 'Oslo' },
        { front: 'Peninsula?', back: 'Scandinavian' },
      ],
    },
  ];

  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    mockPatch.mockResolvedValue({ ok: true, status: 204 });
  });

  it('renders "Template: Basic" pill alongside the cards', () => {
    renderChatPanel({ initialMessages: assistantWithCards });
    expect(
      screen.getByRole('button', { name: 'Note type: Basic' })
    ).toBeInTheDocument();
  });

  it('renders the composer template selector in the empty state', () => {
    renderChatPanel();
    expect(
      screen.getByRole('button', { name: 'Note type: Basic' })
    ).toBeInTheDocument();
  });

  it('renders the template selector on the last assistant turn even with no cards', () => {
    renderChatPanel({
      initialMessages: [
        { role: 'user', content: 'spring boot' },
        { role: 'assistant', content: 'Want cards on a specific area?' },
      ],
    });
    expect(
      screen.getByRole('button', { name: 'Note type: Basic' })
    ).toBeInTheDocument();
  });

  it('opens the template dropdown on click', () => {
    renderChatPanel({ initialMessages: assistantWithCards });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    expect(
      screen.getByRole('listbox', { name: 'Note type' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Basic \+/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Cloze/ })).toBeInTheDocument();
  });

  it('changes template when a menu item is clicked', () => {
    const onTemplateChange = vi.fn();
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: { content: 'Reply', conversationId: 1, cards: [] },
        },
      ])
    );
    renderChatPanel({
      initialMessages: assistantWithCards,
      onTemplateChange,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    expect(onTemplateChange).toHaveBeenCalledWith('cloze');
  });

  it('includes templateSlug in the message API call', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Reply', conversationId: 1 } },
      ])
    );
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialTemplateSlug: 'cloze',
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Make cloze cards' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/message',
        expect.objectContaining({ templateSlug: 'cloze' })
      );
    });
  });

  it('regenerates in place via the conversation endpoint when the template changes', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Reply',
            conversationId: 7,
            cards: [{ front: 'New', back: 'Card' }],
          },
        },
      ])
    );
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/conversations/7/regenerate',
        { templateSlug: 'cloze' }
      );
    });
  });

  it('does not re-send the prior message as a new turn on template change', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Reply',
            conversationId: 7,
            cards: [{ front: 'New', back: 'Card' }],
          },
        },
      ])
    );
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/conversations/7/regenerate',
        { templateSlug: 'cloze' }
      );
    });
    const messageCall = mockPost.mock.calls.find(
      (call) => call[0] === '/api/chat/message'
    );
    expect(messageCall).toBeUndefined();
  });

  it('replaces the target assistant message in place without appending a new one', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Regenerated reply',
            conversationId: 7,
            cards: [{ front: 'Cloze front', back: 'Cloze back' }],
          },
        },
      ])
    );
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(screen.getByText('Cloze front')).toBeInTheDocument();
    });
    expect(screen.queryByText('Capital?')).not.toBeInTheDocument();
    expect(screen.getByText('20 cards about Norway')).toBeInTheDocument();
  });

  it('does not regenerate when there is no saved conversation', async () => {
    renderChatPanel({ initialMessages: assistantWithCards });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('keeps the existing cards visible while regenerating and hides Download', async () => {
    let resolveSse: (v: ReturnType<typeof makeSseResponse>) => void = () => {};
    const sseResponse = new Promise<ReturnType<typeof makeSseResponse>>(
      (res) => {
        resolveSse = res;
      }
    );
    mockPost.mockReturnValueOnce(sseResponse);

    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    expect(
      screen.getByRole('button', { name: 'Download deck' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );

    await waitFor(() => {
      expect(
        screen.getByRole('status', { name: 'Switching to Cloze' })
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Capital?')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Download deck' })
    ).not.toBeInTheDocument();

    resolveSse(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Reply',
            conversationId: 1,
            cards: [{ front: 'New', back: 'Card' }],
          },
        },
      ])
    );

    await waitFor(() => {
      expect(
        screen.queryByRole('status', { name: 'Switching to Cloze' })
      ).not.toBeInTheDocument();
    });
  });

  it('switches basic to basic-and-reversed without calling the server', () => {
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Basic \+/ }).querySelector('button')!
    );
    expect(mockPost).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Note type: Basic + Reverse' })
    ).toBeInTheDocument();
  });

  it('renders reversed duplicate rows after the instant basic-and-reversed switch', () => {
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    expect(screen.getAllByText('Oslo')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Basic \+/ }).querySelector('button')!
    );
    expect(screen.getAllByText('Oslo')).toHaveLength(2);
  });

  it('still calls the server when switching basic to cloze', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Reply',
            conversationId: 7,
            cards: [{ front: 'New', back: 'Card' }],
          },
        },
      ])
    );
    renderChatPanel({
      initialMessages: assistantWithCards,
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/conversations/7/regenerate',
        { templateSlug: 'cloze' }
      );
    });
  });

  it('regenerates a cardless last assistant turn when the template changes', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Reply',
            conversationId: 7,
            cards: [{ front: 'New', back: 'Card' }],
          },
        },
      ])
    );
    renderChatPanel({
      initialMessages: [
        { role: 'user', content: 'spring boot' },
        { role: 'assistant', content: 'Want cards on a specific area?' },
      ],
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/api/chat/conversations/7/regenerate',
        { templateSlug: 'cloze' }
      );
    });
  });

  it('does not regenerate when there is no assistant turn yet', () => {
    renderChatPanel({
      initialMessages: [{ role: 'user', content: 'spring boot' }],
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('consumeSseEvents', () => {
  function streamFromStrings(parts: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
  }

  it('dispatches each complete SSE event in arrival order', async () => {
    const stream = streamFromStrings([
      'event: token\ndata: "Hi"\n\n',
      'event: done\ndata: {"content":"Hi","conversationId":1}\n\n',
    ]);
    const received: Array<[string, string]> = [];

    await consumeSseEvents(stream, (eventType, data) => {
      received.push([eventType, data]);
    });

    expect(received).toEqual([
      ['token', '"Hi"'],
      ['done', '{"content":"Hi","conversationId":1}'],
    ]);
  });

  it('reassembles an event split across two stream chunks', async () => {
    const stream = streamFromStrings(['event: tok', 'en\ndata: "split"\n\n']);
    const received: Array<[string, string]> = [];

    await consumeSseEvents(stream, (eventType, data) => {
      received.push([eventType, data]);
    });

    expect(received).toEqual([['token', '"split"']]);
  });
});

describe('ChatPanel — free-user paywall', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockTrack.mockReset();
    mockUseUserLocals.mockReturnValue(freeUserLocals);
  });

  it('replaces the composer with the upgrade panel for a free user', () => {
    renderChatPanel();

    expect(screen.getByTestId('chat-upgrade-panel')).toBeInTheDocument();
    expect(screen.getByText('Chat is part of a paid plan')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Message input' })
    ).not.toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'chat',
    });
    expect(
      mockTrack.mock.calls.filter(([name]) => name === 'paywall_shown')
    ).toHaveLength(1);
  });

  it('keeps history readable and adds the reassurance line', () => {
    render(
      <MemoryRouter>
        <ChatPanel
          initialMessages={[
            { role: 'user', content: 'Old question' },
            { role: 'assistant', content: 'Old answer' },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Old question')).toBeInTheDocument();
    expect(screen.getByText('Old answer')).toBeInTheDocument();
    expect(
      screen.getByText(/Your past chats stay here to read\./)
    ).toBeInTheDocument();
  });

  it('links the upgrade button to pricing and tracks the click', () => {
    renderChatPanel();

    const cta = screen.getByRole('link', { name: 'See plans' });
    expect(cta).toHaveAttribute('href', '/pricing?source=chat-paywall');
    fireEvent.click(cta);
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'chat',
    });
  });

  it('does not open the consent modal for an unconsented free user', () => {
    mockUseUserLocals.mockReturnValue(makeLocals(null, false));
    renderChatPanel();

    expect(
      screen.queryByRole('heading', {
        name: 'Chat sends your messages to Anthropic',
      })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-upgrade-panel')).toBeInTheDocument();
  });
});

describe('ChatPanel — file-only send', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPostMultipart.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  function attachPdf(name: string) {
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['%PDF'], name, { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('sends a file with no text as the default instruction', async () => {
    mockPostMultipart.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Cards', conversationId: 1 } },
      ])
    );
    renderChatPanel();
    attachPdf('notes.pdf');
    await screen.findByRole('button', { name: 'Remove notes.pdf' });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockPostMultipart).toHaveBeenCalled();
    });
    const formData = mockPostMultipart.mock.calls[0][1] as FormData;
    expect(formData.get('content')).toBe(
      'Create flashcards from the attached file.'
    );
  });

  it('shows the retention hint while a file is attached', async () => {
    renderChatPanel();
    expect(
      screen.queryByText('Attachments are kept for 90 days')
    ).not.toBeInTheDocument();

    attachPdf('notes.pdf');
    await screen.findByRole('button', { name: 'Remove notes.pdf' });

    expect(
      screen.getByText('Attachments are kept for 90 days')
    ).toBeInTheDocument();
  });

  it('shows the default instruction as the user message bubble', async () => {
    mockPostMultipart.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Cards', conversationId: 1 } },
      ])
    );
    renderChatPanel();
    attachPdf('notes.pdf');
    await screen.findByRole('button', { name: 'Remove notes.pdf' });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByText('Create flashcards from the attached file.')
      ).toBeInTheDocument();
    });
  });
});

describe('ChatPanel — regenerate with attachments', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('explains that attached files cannot be reused when regenerate refuses', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'error', data: { type: 'attachments_not_replayable' } },
      ])
    );
    renderChatPanel({
      initialMessages: [
        { role: 'user', content: 'Create flashcards from the attached file.' },
        {
          role: 'assistant',
          content: 'Reply',
          cards: [{ front: 'Capital?', back: 'Oslo' }],
        },
      ],
      initialTemplateSlug: 'basic',
      initialConversationId: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Basic' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          "Regenerate can't reuse attached files — attachments are kept for 90 days. Re-attach the file and send a new message."
        )
      ).toBeInTheDocument();
    });
  });
});

describe('ChatPanel — typed note type requests', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPatch.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('adopts the produced note type and skips regenerate on reselect', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: '```json\n[{"front":"X is {{c1::Y}}.","back":""}]\n```',
            conversationId: 7,
            cards: [{ front: 'X is {{c1::Y}}.', back: '' }],
          },
        },
      ])
    );
    renderChatPanel({ initialTemplateSlug: 'basic', initialConversationId: 7 });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'cloze please' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        '/api/chat/conversations/7/template',
        { templateSlug: 'cloze' }
      );
    });

    mockPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Note type: Cloze' }));
    fireEvent.click(
      screen.getByRole('option', { name: /Cloze/ }).querySelector('button')!
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows a note type control in the empty composer', () => {
    renderChatPanel();
    expect(
      screen.getByRole('button', { name: 'Note type: Basic' })
    ).toBeInTheDocument();
  });

  it('shows exactly one note type control once an assistant reply exists', () => {
    renderChatPanel({
      initialMessages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: 'r',
          cards: [{ front: 'a', back: 'b' }],
        },
      ],
    });
    expect(screen.getAllByRole('button', { name: /Note type/ })).toHaveLength(
      1
    );
  });
});
