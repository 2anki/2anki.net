import { vi, type Mock } from 'vitest';
import SettingsService from './SettingsService';
import SettingsRepository from '../data_layer/SettingsRepository';

function makeRepository(deleteImpl: Mock): SettingsRepository {
  return { delete: deleteImpl } as unknown as SettingsRepository;
}

describe('SettingsService.delete', () => {
  it('resolves after delegating the deletion to the repository', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const service = new SettingsService(makeRepository(del));

    await expect(
      service.delete('owner-1', 'object-9')
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith('owner-1', 'object-9');
  });

  it('rejects with the repository error when the deletion fails', async () => {
    const failure = new Error('delete failed');
    const del = vi.fn().mockRejectedValue(failure);
    const service = new SettingsService(makeRepository(del));

    await expect(service.delete('owner-1', 'object-9')).rejects.toBe(failure);
  });
});
