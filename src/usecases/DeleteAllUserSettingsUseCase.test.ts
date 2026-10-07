import { vi } from 'vitest';
import DeleteAllUserSettingsUseCase from './DeleteAllUserSettingsUseCase';

describe('DeleteAllUserSettingsUseCase', () => {
  const mockSettingsRepo = {
    deleteAllByOwner: vi.fn(),
  };
  const mockParserRulesRepo = {
    deleteAllByOwner: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls deleteAllByOwner on both repos with the given owner', async () => {
    mockSettingsRepo.deleteAllByOwner.mockResolvedValue(3);
    mockParserRulesRepo.deleteAllByOwner.mockResolvedValue(2);

    const useCase = new DeleteAllUserSettingsUseCase(
      mockSettingsRepo as any,
      mockParserRulesRepo as any
    );

    await useCase.execute('owner-123');

    expect(mockSettingsRepo.deleteAllByOwner).toHaveBeenCalledWith('owner-123');
    expect(mockParserRulesRepo.deleteAllByOwner).toHaveBeenCalledWith(
      'owner-123'
    );
  });

  it('resolves when owner has no rows (idempotent)', async () => {
    mockSettingsRepo.deleteAllByOwner.mockResolvedValue(0);
    mockParserRulesRepo.deleteAllByOwner.mockResolvedValue(0);

    const useCase = new DeleteAllUserSettingsUseCase(
      mockSettingsRepo as any,
      mockParserRulesRepo as any
    );

    await expect(useCase.execute('owner-empty')).resolves.toBeUndefined();
  });

  it('propagates errors from the settings repo', async () => {
    mockSettingsRepo.deleteAllByOwner.mockRejectedValue(new Error('DB error'));
    mockParserRulesRepo.deleteAllByOwner.mockResolvedValue(0);

    const useCase = new DeleteAllUserSettingsUseCase(
      mockSettingsRepo as any,
      mockParserRulesRepo as any
    );

    await expect(useCase.execute('owner-123')).rejects.toThrow('DB error');
  });
});
