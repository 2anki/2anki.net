import { vi } from 'vitest';
import { IErrorEventRepository } from '../../../../data_layer/ErrorEventRepository';
import {
  assessDeletionVolume,
  raiseDeletionVolumeAlarm,
  DELETION_VOLUME_ABSOLUTE_THRESHOLD,
  DELETION_VOLUME_TABLE_FRACTION_MIN_TOTAL,
} from './deletionVolumeAlert';

describe('assessDeletionVolume', () => {
  it('is not anomalous for a normal-volume run', () => {
    const assessment = assessDeletionVolume(3, 5000);

    expect(assessment.anomalous).toBe(false);
    expect(assessment.reasons).toEqual([]);
  });

  it('flags a run that reaches the absolute threshold', () => {
    const assessment = assessDeletionVolume(
      DELETION_VOLUME_ABSOLUTE_THRESHOLD,
      1_000_000
    );

    expect(assessment.anomalous).toBe(true);
    expect(assessment.reasons.join(' ')).toContain('absolute threshold');
  });

  it('flags a run that sweeps too large a fraction of a sizeable table', () => {
    const assessment = assessDeletionVolume(
      30,
      DELETION_VOLUME_TABLE_FRACTION_MIN_TOTAL
    );

    expect(assessment.anomalous).toBe(true);
    expect(assessment.reasons.join(' ')).toContain('% of the table');
  });

  it('does not apply the fraction rule below the minimum-table floor', () => {
    const assessment = assessDeletionVolume(3, 8);

    expect(assessment.anomalous).toBe(false);
  });

  it('does not flag deleting the whole of a below-floor table', () => {
    const belowFloor = DELETION_VOLUME_TABLE_FRACTION_MIN_TOTAL - 1;
    const assessment = assessDeletionVolume(belowFloor, belowFloor);

    expect(assessment.anomalous).toBe(false);
  });
});

describe('raiseDeletionVolumeAlarm', () => {
  it('records a server-source error event on the ops path', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const assessment = assessDeletionVolume(
      DELETION_VOLUME_ABSOLUTE_THRESHOLD,
      2000
    );

    await raiseDeletionVolumeAlarm('someCleanupJob', assessment, {
      insert,
    } as unknown as IErrorEventRepository);

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row.source).toBe('server');
    expect(row.context).toMatchObject({
      job: 'someCleanupJob',
      deletedCount: DELETION_VOLUME_ABSOLUTE_THRESHOLD,
      tableTotal: 2000,
    });
    errorSpy.mockRestore();
  });

  it('never throws when recording the ops event fails', async () => {
    const insert = vi.fn().mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const assessment = assessDeletionVolume(
      DELETION_VOLUME_ABSOLUTE_THRESHOLD,
      2000
    );

    await expect(
      raiseDeletionVolumeAlarm('someCleanupJob', assessment, {
        insert,
      } as unknown as IErrorEventRepository)
    ).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
