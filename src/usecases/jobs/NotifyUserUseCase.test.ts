import { vi } from 'vitest';
import UsersRepository from '../../data_layer/UsersRepository';
import ParserRules from '../../lib/parser/ParserRules';
import { NotifyUserUseCase } from './NotifyUserUseCase';

const sendConversionEmail = vi.fn();
const sendConversionLinkEmail = vi.fn();

vi.mock('../../services/EmailService/EmailService', () => ({
  getDefaultEmailService: () => ({
    sendConversionEmail,
    sendConversionLinkEmail,
  }),
}));

const APKG = Buffer.from('apkg-bytes');

function makeRules(emailNotification: boolean): ParserRules {
  const rules = new ParserRules();
  rules.EMAIL_NOTIFICATION = emailNotification;
  return rules;
}

function makeUsersRepository(email: string | undefined): UsersRepository {
  return {
    getEmailById: vi.fn().mockResolvedValue(email),
  } as unknown as UsersRepository;
}

beforeEach(() => {
  sendConversionEmail.mockReset();
  sendConversionLinkEmail.mockReset();
});

describe('NotifyUserUseCase', () => {
  it('sends a link email when the apkg is larger than 24 MB', async () => {
    const usersRepository = makeUsersRepository('a@example.com');
    const useCase = new NotifyUserUseCase(usersRepository);

    await useCase.execute({
      owner: 'user-1',
      rules: makeRules(false),
      key: 'abc',
      id: 'deck-1',
      size: 25,
      apkg: APKG,
      cardCount: 120,
    });

    expect(sendConversionLinkEmail).toHaveBeenCalledWith(
      'a@example.com',
      'deck-1',
      expect.stringContaining('/api/download/u/abc'),
      120
    );
    expect(sendConversionEmail).not.toHaveBeenCalled();
  });

  it('sends an attachment email when EMAIL_NOTIFICATION is on and the file is small', async () => {
    const usersRepository = makeUsersRepository('b@example.com');
    const useCase = new NotifyUserUseCase(usersRepository);

    await useCase.execute({
      owner: 'user-2',
      rules: makeRules(true),
      key: 'xyz',
      id: 'deck-2',
      size: 5,
      apkg: APKG,
      cardCount: 42,
    });

    expect(sendConversionEmail).toHaveBeenCalledWith(
      'b@example.com',
      'deck-2',
      APKG,
      42
    );
    expect(sendConversionLinkEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when neither condition is met', async () => {
    const usersRepository = makeUsersRepository('c@example.com');
    const useCase = new NotifyUserUseCase(usersRepository);

    await useCase.execute({
      owner: 'user-3',
      rules: makeRules(false),
      key: 'k',
      id: 'deck-3',
      size: 5,
      apkg: APKG,
    });

    expect(usersRepository.getEmailById).not.toHaveBeenCalled();
    expect(sendConversionEmail).not.toHaveBeenCalled();
    expect(sendConversionLinkEmail).not.toHaveBeenCalled();
  });

  it('skips sending when the user has no email on file', async () => {
    const usersRepository = makeUsersRepository(undefined);
    const useCase = new NotifyUserUseCase(usersRepository);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await useCase.execute({
        owner: 'user-4',
        rules: makeRules(true),
        key: 'k',
        id: 'deck-4',
        size: 5,
        apkg: APKG,
      });
      expect(sendConversionEmail).not.toHaveBeenCalled();
      expect(sendConversionLinkEmail).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
