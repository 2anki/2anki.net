import {
  ChangeUserEmailRepository,
  ChangeUserEmailUseCase,
} from './ChangeUserEmailUseCase';
import type { EventsSink } from '../../services/events/EventsSink';

interface FakeUser {
  id: number;
  email: string;
}

interface FakeSubscription {
  email: string;
  linked_email: string | null;
}

class FakeUsersRepository implements ChangeUserEmailRepository {
  constructor(
    public users: FakeUser[],
    public subscriptions: FakeSubscription[]
  ) {}

  async getByEmail(email: string): Promise<{ id: number } | undefined> {
    const normalized = email.trim().toLowerCase();
    return this.users.find((u) => u.email.trim().toLowerCase() === normalized);
  }

  async changeEmailAndRelinkSubscriptions(
    currentEmail: string,
    newEmail: string
  ): Promise<void> {
    const current = currentEmail.trim().toLowerCase();
    const next = newEmail.trim().toLowerCase();
    for (const user of this.users) {
      if (user.email.trim().toLowerCase() === current) {
        user.email = next;
      }
    }
    for (const subscription of this.subscriptions) {
      if (subscription.email.toLowerCase() === current) {
        subscription.linked_email = next;
      }
    }
  }
}

function makeEventsSink(): Pick<EventsSink, 'record'> {
  return { record: jest.fn() };
}

const NOW = new Date('2026-09-01T12:00:00Z');

describe('ChangeUserEmailUseCase', () => {
  it('moves the account email and re-links the subscription in one call', async () => {
    const repo = new FakeUsersRepository(
      [{ id: 42, email: 'old@example.com' }],
      [{ email: 'old@example.com', linked_email: 'old@example.com' }]
    );
    const eventsSink = makeEventsSink();
    const useCase = new ChangeUserEmailUseCase(repo, eventsSink);

    const outcome = await useCase.execute(
      { currentEmail: 'old@example.com', newEmail: 'new@example.com' },
      NOW
    );

    expect(outcome).toEqual({ success: true, userId: 42 });
    expect(repo.users[0].email).toBe('new@example.com');
    expect(repo.subscriptions[0].linked_email).toBe('new@example.com');
    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'ops_user_email_changed',
      user_id: 42,
      props: { method: 'ops' },
      created_at: NOW,
    });
  });

  it('leaves the subscription payer email (subscriptions.email) untouched', async () => {
    const repo = new FakeUsersRepository(
      [{ id: 7, email: 'learner@example.com' }],
      [{ email: 'learner@example.com', linked_email: 'learner@example.com' }]
    );
    const useCase = new ChangeUserEmailUseCase(repo, makeEventsSink());

    await useCase.execute(
      { currentEmail: 'learner@example.com', newEmail: 'moved@example.com' },
      NOW
    );

    expect(repo.subscriptions[0].email).toBe('learner@example.com');
    expect(repo.subscriptions[0].linked_email).toBe('moved@example.com');
  });

  it('matches the current email case-insensitively and normalizes the new email', async () => {
    const repo = new FakeUsersRepository(
      [{ id: 9, email: 'Mixed@Example.com' }],
      []
    );
    const useCase = new ChangeUserEmailUseCase(repo, makeEventsSink());

    const outcome = await useCase.execute(
      { currentEmail: '  MIXED@example.COM ', newEmail: '  NEW@Example.com ' },
      NOW
    );

    expect(outcome).toEqual({ success: true, userId: 9 });
    expect(repo.users[0].email).toBe('new@example.com');
  });

  it('returns user_not_found when no account matches the current email', async () => {
    const repo = new FakeUsersRepository([], []);
    const eventsSink = makeEventsSink();
    const useCase = new ChangeUserEmailUseCase(repo, eventsSink);

    const outcome = await useCase.execute(
      { currentEmail: 'ghost@example.com', newEmail: 'new@example.com' },
      NOW
    );

    expect(outcome).toEqual({ success: false, reason: 'user_not_found' });
    expect(eventsSink.record).not.toHaveBeenCalled();
  });

  it('returns new_email_taken when another account already owns the new email (case-varied)', async () => {
    const repo = new FakeUsersRepository(
      [
        { id: 1, email: 'moving@example.com' },
        { id: 2, email: 'Taken@Example.com' },
      ],
      []
    );
    const eventsSink = makeEventsSink();
    const useCase = new ChangeUserEmailUseCase(repo, eventsSink);

    const outcome = await useCase.execute(
      { currentEmail: 'moving@example.com', newEmail: 'taken@example.com' },
      NOW
    );

    expect(outcome).toEqual({ success: false, reason: 'new_email_taken' });
    expect(repo.users[0].email).toBe('moving@example.com');
    expect(eventsSink.record).not.toHaveBeenCalled();
  });

  it('returns same_email when the new email normalizes to the current one', async () => {
    const repo = new FakeUsersRepository(
      [{ id: 3, email: 'same@example.com' }],
      []
    );
    const eventsSink = makeEventsSink();
    const useCase = new ChangeUserEmailUseCase(repo, eventsSink);

    const outcome = await useCase.execute(
      { currentEmail: 'same@example.com', newEmail: ' SAME@example.com ' },
      NOW
    );

    expect(outcome).toEqual({ success: false, reason: 'same_email' });
    expect(eventsSink.record).not.toHaveBeenCalled();
  });
});
