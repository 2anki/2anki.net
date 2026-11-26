import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ContactMessage } from '../../lib/backend/Backend';
import ContactMessagesTab from './ContactMessagesTab';
import { UNREAD_MESSAGES_QUERY_KEY } from './useUnreadMessageCount';

const mockListContactMessages = vi.fn();
const mockAcknowledgeContactMessage = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    listContactMessages: mockListContactMessages,
    acknowledgeContactMessage: mockAcknowledgeContactMessage,
  }),
}));

const buildMessage = (
  overrides: Partial<ContactMessage> = {}
): ContactMessage => ({
  id: 1,
  name: 'A reporter',
  email: 'reporter@example.com',
  message: 'Conversion failed on a large export.',
  attachments: null,
  is_acknowledged: false,
  created_at: '2026-05-30T12:00:00.000Z',
  ...overrides,
});

function renderTab(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <ContactMessagesTab />
    </QueryClientProvider>
  );
  return queryClient;
}

describe('ContactMessagesTab acknowledge action', () => {
  beforeEach(() => {
    mockListContactMessages.mockResolvedValue([buildMessage()]);
    mockAcknowledgeContactMessage.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('marks a message as read when the request succeeds', async () => {
    mockAcknowledgeContactMessage.mockResolvedValue(undefined);
    renderTab();

    const button = await screen.findByRole('button', { name: 'Mark as read' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Acknowledged' })
      ).toBeInTheDocument()
    );
    expect(mockAcknowledgeContactMessage).toHaveBeenCalledWith(1, true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('refreshes the sidebar unread count once a message is marked as read', async () => {
    mockAcknowledgeContactMessage.mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderTab(queryClient);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark as read' })
    );

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: UNREAD_MESSAGES_QUERY_KEY,
      })
    );
  });

  test('reverts the toggle and shows an error when the request fails', async () => {
    mockAcknowledgeContactMessage.mockRejectedValue(new Error('500'));
    renderTab();

    const button = await screen.findByRole('button', { name: 'Mark as read' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't mark this message as read. Try again."
      )
    );
    expect(
      screen.getByRole('button', { name: 'Mark as read' })
    ).toBeInTheDocument();
  });

  test('scopes the failure error to the message that failed', async () => {
    mockListContactMessages.mockResolvedValue([
      buildMessage({ id: 1, name: 'First reporter' }),
      buildMessage({ id: 2, name: 'Second reporter' }),
    ]);
    mockAcknowledgeContactMessage.mockRejectedValue(new Error('500'));
    renderTab();

    const buttons = await screen.findAllByRole('button', {
      name: 'Mark as read',
    });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  });
});
