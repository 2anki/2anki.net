import SettingsService from './SettingsService';
import SettingsRepository from '../data_layer/SettingsRepository';

function makeRepository(deleteImpl: jest.Mock): SettingsRepository {
  return { delete: deleteImpl } as unknown as SettingsRepository;
}

describe('SettingsService.delete', () => {
  it('resolves after delegating the deletion to the repository', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const service = new SettingsService(makeRepository(del));

    await expect(
      service.delete('owner-1', 'object-9')
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith('owner-1', 'object-9');
  });

  it('rejects with the repository error when the deletion fails', async () => {
    const failure = new Error('delete failed');
    const del = jest.fn().mockRejectedValue(failure);
    const service = new SettingsService(makeRepository(del));

    await expect(service.delete('owner-1', 'object-9')).rejects.toBe(failure);
  });
});
