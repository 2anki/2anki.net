import { UserDeletionService } from './UserDeletionService';

describe('UserDeletionService', () => {
  it('sweeps the user attachment prefix before deleting the user', async () => {
    const calls: string[] = [];
    const service = new UserDeletionService(
      {
        deleteUser: async (owner) => {
          calls.push(`delete:${owner}`);
          return 1;
        },
      },
      {
        deleteByPrefix: async (prefix) => {
          calls.push(`sweep:${prefix}`);
          return 3;
        },
      }
    );

    await service.deleteUser('42');

    expect(calls).toEqual(['sweep:chat-attachments/42/', 'delete:42']);
  });

  it('still deletes the user when the sweep fails', async () => {
    const deleteUser = jest.fn().mockResolvedValue(1);
    const service = new UserDeletionService(
      { deleteUser },
      {
        deleteByPrefix: jest.fn().mockRejectedValue(new Error('storage down')),
      }
    );

    await service.deleteUser('42');

    expect(deleteUser).toHaveBeenCalledWith('42');
  });

  it('propagates a repository failure', async () => {
    const service = new UserDeletionService(
      { deleteUser: jest.fn().mockRejectedValue(new Error('db down')) },
      { deleteByPrefix: jest.fn().mockResolvedValue(0) }
    );

    await expect(service.deleteUser('42')).rejects.toThrow('db down');
  });
});
