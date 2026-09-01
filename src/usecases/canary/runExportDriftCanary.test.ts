import { setupTests } from '../../test/configure-jest';
import {
  runExportDriftCanary,
  EXPORT_DRIFT_FIXTURES,
  ExportDriftFixture,
} from './runExportDriftCanary';

beforeEach(() => setupTests());

const perturb = (
  fixture: ExportDriftFixture,
  overrides: Partial<ExportDriftFixture['baseline']>
): ExportDriftFixture => ({
  ...fixture,
  baseline: { ...fixture.baseline, ...overrides },
});

describe('runExportDriftCanary', () => {
  test('passes against the current fixtures with the committed baselines', async () => {
    const result = await runExportDriftCanary();
    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.failures).toHaveLength(0);
    }
  }, 60000);

  test('represents the known Notion drift classes in the reference fixtures', () => {
    const classes = EXPORT_DRIFT_FIXTURES.map((f) => f.driftClass).join(' | ');
    expect(classes).toContain('display:contents');
    expect(classes).toContain('details.toggle');
    expect(classes).toContain('figure.image');
    expect(classes).toContain('figure.equation');
  });

  test('keeps the figure.image fixture embedding its bundled subfolder image', async () => {
    const fixture = EXPORT_DRIFT_FIXTURES.find((f) =>
      f.driftClass.startsWith('figure.image')
    )!;
    const result = await runExportDriftCanary([fixture]);
    expect(result.status).toBe('pass');
    expect(fixture.baseline.mediaCount).toBe(1);
    expect(fixture.baseline.cardCount).toBe(1);
  }, 30000);

  test('keeps the figure.equation fixture producing a non-empty back', async () => {
    const fixture = EXPORT_DRIFT_FIXTURES.find((f) =>
      f.driftClass.startsWith('figure.equation')
    )!;
    const result = await runExportDriftCanary([fixture]);
    expect(result.status).toBe('pass');
    expect(fixture.baseline.cardCount).toBe(1);
    expect(fixture.baseline.nonEmptyBackCount).toBe(1);
  }, 30000);

  test('alerts with a field-level diff when the card count drifts', async () => {
    const target = EXPORT_DRIFT_FIXTURES[0];
    const result = await runExportDriftCanary([
      perturb(target, { cardCount: target.baseline.cardCount + 5 }),
    ]);

    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.failures).toHaveLength(1);
      const [failure] = result.failures;
      expect(failure.driftClass).toBe(target.driftClass);
      expect(failure.divergedFields).toEqual(['cardCount']);
      expect(failure.actual.cardCount).toBe(target.baseline.cardCount);
      expect(failure.expected.cardCount).toBe(target.baseline.cardCount + 5);
    }
  });

  test('alerts when front/back non-emptiness drifts', async () => {
    const target = EXPORT_DRIFT_FIXTURES[1];
    const result = await runExportDriftCanary([
      perturb(target, {
        nonEmptyBackCount: target.baseline.nonEmptyBackCount + 1,
      }),
    ]);

    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.failures[0].divergedFields).toEqual(['nonEmptyBackCount']);
    }
  });

  test('reports every diverged field, not just the first', async () => {
    const target = EXPORT_DRIFT_FIXTURES[0];
    const result = await runExportDriftCanary([
      perturb(target, { cardCount: 99, mediaCount: 99 }),
    ]);

    expect(result.status).toBe('fail');
    if (result.status === 'fail') {
      expect(result.failures[0].divergedFields).toEqual(
        expect.arrayContaining(['cardCount', 'mediaCount'])
      );
    }
  });
});
