import { InMemoryUserPreferencesRepository } from '../../data_layer/UserPreferencesRepository';
import { SetBlockIdIdentityUseCase } from './SetBlockIdIdentityUseCase';

function buildUsers(known: Record<string, number>) {
  return {
    getByEmail: jest.fn(async (email: string) => {
      const id = known[email.toLowerCase()];
      return id == null ? undefined : { id };
    }),
  };
}

describe('SetBlockIdIdentityUseCase', () => {
  it('stores block-id-identity=true on the account matching the email', async () => {
    const prefs = new InMemoryUserPreferencesRepository();
    await prefs.patch(21, { cardOptions: { template: 'custom' } });
    const useCase = new SetBlockIdIdentityUseCase(
      buildUsers({ 'learner@example.com': 21 }),
      prefs
    );

    const outcome = await useCase.execute({
      email: 'Learner@example.com',
      enabled: true,
    });

    expect(outcome).toEqual({
      success: true,
      userId: 21,
      blockIdIdentity: true,
    });
    expect((await prefs.get(21)).cardOptions).toEqual({
      template: 'custom',
      'block-id-identity': 'true',
    });
  });

  it('removes the override instead of storing false when disabled', async () => {
    const prefs = new InMemoryUserPreferencesRepository();
    await prefs.patch(21, {
      cardOptions: { template: 'custom', 'block-id-identity': 'true' },
    });
    const useCase = new SetBlockIdIdentityUseCase(
      buildUsers({ 'learner@example.com': 21 }),
      prefs
    );

    const outcome = await useCase.execute({
      email: 'learner@example.com',
      enabled: false,
    });

    expect(outcome).toEqual({
      success: true,
      userId: 21,
      blockIdIdentity: false,
    });
    expect((await prefs.get(21)).cardOptions).toEqual({ template: 'custom' });
  });

  it('reports user_not_found without touching preferences', async () => {
    const prefs = new InMemoryUserPreferencesRepository();
    const spy = jest.spyOn(prefs, 'setBlockIdIdentity');
    const useCase = new SetBlockIdIdentityUseCase(buildUsers({}), prefs);

    const outcome = await useCase.execute({
      email: 'nobody@example.com',
      enabled: true,
    });

    expect(outcome).toEqual({ success: false, reason: 'user_not_found' });
    expect(spy).not.toHaveBeenCalled();
  });
});
