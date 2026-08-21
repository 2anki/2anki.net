import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatPage from './ChatPage';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

function renderChatPage(path = '/chat') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>
  );
}

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: {
      locals: { owner: 1, patreon: false, subscriber: true },
      user: { patreon: false, chat_consent_at: '2026-01-01T00:00:00.000Z' },
    },
    refetch: vi.fn(),
  }),
}));

vi.mock('../../lib/backend/api', () => ({
  post: vi.fn(),
  postMultipart: vi.fn(),
  get: vi.fn().mockResolvedValue({ used: 0, limit: 20 }),
  del: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

import { del, get, post, postMultipart } from '../../lib/backend/api';
import { track } from '../../lib/analytics/track';

const mockPost = post as ReturnType<typeof vi.fn>;
const mockGet = get as ReturnType<typeof vi.fn>;
const mockPostMultipart = postMultipart as ReturnType<typeof vi.fn>;
const mockDel = del as ReturnType<typeof vi.fn>;
const mockTrack = track as ReturnType<typeof vi.fn>;

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

describe('ChatPage', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPostMultipart.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
    mockPost.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    } as Response);
  });

  it('renders the empty state heading', () => {
    renderChatPage();
    expect(
      screen.getByRole('heading', { name: 'What are you studying?' })
    ).toBeInTheDocument();
  });

  it('renders CardPreview when assistant message has cards', async () => {
    const cards = [
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ];
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: {
            content: 'Here are cards:\n```json\n[]\n```\nDone!',
            contentBefore: 'Here are cards:',
            contentAfter: 'Done!',
            cards,
          },
        },
      ])
    );

    renderChatPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Make cards' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('Here are cards:')).toBeInTheDocument();
    expect(screen.getByText('Done!')).toBeInTheDocument();
  });

  it('renders plain text for assistant message without cards', async () => {
    mockPost.mockResolvedValueOnce(
      makeSseResponse([
        {
          event: 'done',
          data: { content: 'Photosynthesis is the process...' },
        },
      ])
    );

    renderChatPage();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Explain photosynthesis' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByText('Photosynthesis is the process...')
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('Download deck')).not.toBeInTheDocument();
  });

  it('shows Writing your cards indicator and hides JSON while streaming cards', async () => {
    const cards = [{ front: 'Q1', back: 'A1' }];
    const encoder = new TextEncoder();
    let enqueue!: (chunk: Uint8Array) => void;
    let close!: () => void;
    const stream = new ReadableStream({
      start(controller) {
        enqueue = (c) => controller.enqueue(c);
        close = () => controller.close();
      },
    });
    mockPost.mockResolvedValueOnce({ ok: true, status: 200, body: stream });

    renderChatPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Make cards' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    enqueue(encoder.encode('event: token\ndata: "Here are your cards:"\n\n'));
    enqueue(encoder.encode('event: token\ndata: "\\n```json"\n\n'));
    enqueue(
      encoder.encode(
        'event: token\ndata: "[{\\"front\\":\\"Q1\\",\\"back\\":\\"A1\\"}]"\n\n'
      )
    );

    await waitFor(() => {
      expect(screen.getByText('Writing your cards')).toBeInTheDocument();
    });
    expect(screen.queryByText(/```json/)).not.toBeInTheDocument();

    enqueue(
      encoder.encode(
        `event: done\ndata: ${JSON.stringify({
          content:
            'Here are your cards:\n```json\n[{"front":"Q1","back":"A1"}]\n```',
          contentBefore: 'Here are your cards:',
          cards,
        })}\n\n`
      )
    );
    close();

    await waitFor(() => {
      expect(screen.getByText('Q1')).toBeInTheDocument();
    });
    expect(screen.queryByText('Writing your cards')).not.toBeInTheDocument();
  });

  it('does not collapse short user messages', async () => {
    renderChatPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Short message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(
      screen.queryByRole('button', { name: 'Show full message' })
    ).not.toBeInTheDocument();
  });

  it('collapses long user messages and shows expand toggle', () => {
    renderChatPage();
    const longContent = 'x'.repeat(601);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: longContent },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(
      screen.getByRole('button', { name: 'Show full message' })
    ).toBeInTheDocument();
  });

  it('toggles long message between collapsed and expanded', () => {
    renderChatPage();
    const longContent = 'x'.repeat(601);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: longContent },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    const toggle = screen.getByRole('button', { name: 'Show full message' });
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Show less' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(
      screen.getByRole('button', { name: 'Show full message' })
    ).toBeInTheDocument();
  });

  it('does not call the removed usage endpoint on mount', async () => {
    renderChatPage();

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/chat/conversations', {
        redirect: false,
      });
    });
    expect(mockGet).not.toHaveBeenCalledWith('/api/chat/usage', {
      redirect: false,
    });
  });

  it('shows paperclip button in the composer', () => {
    renderChatPage();
    expect(
      screen.getByRole('button', { name: 'Attach files' })
    ).toBeInTheDocument();
  });

  it('shows chip when a valid file is attached via input', async () => {
    renderChatPage();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'lecture.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTitle('lecture.pdf')).toBeInTheDocument();
    });
  });

  it('shows a chip for a .docx, which the server has always accepted', async () => {
    renderChatPage();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['data'], 'lecture.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTitle('lecture.docx')).toBeInTheDocument();
    });
  });

  it('shows error when file type is not allowed', async () => {
    renderChatPage();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['data'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText(/Can't attach clip.mp4/)).toBeInTheDocument();
    });
  });

  it('removes chip when the remove button is clicked', async () => {
    renderChatPage();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'notes.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTitle('notes.pdf')).toBeInTheDocument();
    });

    const removeBtn = screen.getByRole('button', { name: 'Remove notes.pdf' });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByTitle('notes.pdf')).not.toBeInTheDocument();
    });
  });

  it('uses postMultipart when files are attached', async () => {
    mockPostMultipart.mockResolvedValueOnce(
      makeSseResponse([
        { event: 'done', data: { content: 'Answer', conversationId: 1 } },
      ])
    );

    renderChatPage();
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'slides.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTitle('slides.pdf')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
      target: { value: 'Summarize this' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockPostMultipart).toHaveBeenCalledWith(
        '/api/chat/message',
        expect.any(FormData)
      );
    });
  });

  it('never renders a monthly message counter', async () => {
    renderChatPage();

    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: 'Message input' })
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/message(s)? left this month/)
    ).not.toBeInTheDocument();
  });
});

describe('ChatPage — query-param handling', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('pre-fills input with filename from query param when from=upload', async () => {
    renderChatPage('/chat?from=upload&filename=Biology.epub');
    await waitFor(() => {
      const textarea = screen.getByRole('textbox', {
        name: 'Message input',
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe(
        'I tried to convert Biology.epub and got stuck. What can I do?'
      );
    });
  });

  it('falls back to "this file" when filename param is absent', async () => {
    renderChatPage('/chat?from=upload');
    await waitFor(() => {
      const textarea = screen.getByRole('textbox', {
        name: 'Message input',
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe(
        'I tried to convert this file and got stuck. What can I do?'
      );
    });
  });

  it('does not render starter chips', () => {
    renderChatPage('/chat');
    expect(
      screen.queryByText('Make cards from a topic')
    ).not.toBeInTheDocument();
  });

  it('renders the upload empty-state heading when from=upload', () => {
    renderChatPage('/chat?from=upload');
    expect(
      screen.getByRole('heading', {
        name: 'What would you like to do with this file?',
      })
    ).toBeInTheDocument();
  });
});

describe('ChatPage — mobile conversation drawer', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockResolvedValue({ used: 0, limit: 20 });
  });

  it('exposes Past chats and New chat in the mobile bar', () => {
    renderChatPage();
    expect(
      screen.getByRole('button', { name: 'Past chats' })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'New chat' }).length
    ).toBeGreaterThanOrEqual(1);
  });

  it('opens the conversation drawer when Past chats is tapped', () => {
    renderChatPage();
    expect(
      screen.queryByRole('button', { name: 'Close conversations' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Past chats' }));
    expect(
      screen.getByRole('button', { name: 'Close conversations' })
    ).toBeInTheDocument();
  });

  it('closes the drawer when the scrim is tapped', () => {
    renderChatPage();
    fireEvent.click(screen.getByRole('button', { name: 'Past chats' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Close conversations' })
    );
    expect(
      screen.queryByRole('button', { name: 'Close conversations' })
    ).not.toBeInTheDocument();
  });

  it('closes the drawer after selecting a conversation', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/chat/conversations') {
        return Promise.resolve({
          conversations: [
            {
              id: 7,
              title: 'Krebs cycle',
              updatedAt: '2026-06-10T00:00:00.000Z',
            },
          ],
        });
      }
      if (url === '/api/chat/conversations/7') {
        return Promise.resolve({
          id: 7,
          title: 'Krebs cycle',
          draft: null,
          templateSlug: null,
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z',
          messages: [],
        });
      }
      return Promise.resolve({ used: 0, limit: 20 });
    });

    renderChatPage();
    await waitFor(() => {
      expect(screen.getByText('Krebs cycle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Past chats' }));
    expect(
      screen.getByRole('button', { name: 'Close conversations' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Krebs cycle'));

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Close conversations' })
      ).not.toBeInTheDocument();
    });
  });
});

describe('ChatPage — delete all conversations', () => {
  function mockConversationsList() {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/chat/conversations') {
        return Promise.resolve({
          conversations: [
            { id: 1, title: 'Alpha', updatedAt: '2026-06-10T00:00:00.000Z' },
            { id: 2, title: 'Beta', updatedAt: '2026-06-09T00:00:00.000Z' },
          ],
        });
      }
      return Promise.resolve({ used: 0, limit: 20 });
    });
  }

  beforeEach(() => {
    mockDel.mockReset();
    mockTrack.mockReset();
    mockConversationsList();
  });

  it('clears the list, calls the collection endpoint, and tracks', async () => {
    mockDel.mockResolvedValue({ ok: true, status: 204 });
    renderChatPage();
    await screen.findByText('Alpha');

    fireEvent.click(screen.getByText('Delete all chats'));
    const dialogButtons = screen.getAllByText('Delete all chats');
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() =>
      expect(mockDel).toHaveBeenCalledWith('/api/chat/conversations', {
        redirect: false,
      })
    );
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith('chat_all_conversations_deleted', {
        count: 2,
      })
    );
  });

  it('restores the list and shows the error when the request fails', async () => {
    mockDel.mockResolvedValue({ ok: false, status: 500 });
    renderChatPage();
    await screen.findByText('Alpha');

    fireEvent.click(screen.getByText('Delete all chats'));
    const dialogButtons = screen.getAllByText('Delete all chats');
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await screen.findByText("Couldn't delete your chats. Try again.");
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
