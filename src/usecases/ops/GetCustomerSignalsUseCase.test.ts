import { vi } from 'vitest';
import {
  CustomerSignalsResponse,
  CustomerSignalsService,
} from '../../services/ops/CustomerSignalsService';
import { GetCustomerSignalsUseCase } from './GetCustomerSignalsUseCase';

const emptyResponse: CustomerSignalsResponse = {
  signals: [],
  since: '',
  as_of: '',
};

function buildUseCase() {
  const getSignals = vi.fn().mockResolvedValue(emptyResponse);
  const service = { getSignals } as unknown as CustomerSignalsService;
  return { useCase: new GetCustomerSignalsUseCase(service), getSignals };
}

const daysAgo = (since: Date): number =>
  Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000));

describe('GetCustomerSignalsUseCase', () => {
  it('defaults to a 30-day window', async () => {
    const { useCase, getSignals } = buildUseCase();

    await useCase.execute(undefined);

    expect(getSignals).toHaveBeenCalledTimes(1);
    expect(daysAgo(getSignals.mock.calls[0][0] as Date)).toBe(30);
  });

  it('honours a valid window', async () => {
    const { useCase, getSignals } = buildUseCase();

    await useCase.execute('7d');

    expect(daysAgo(getSignals.mock.calls[0][0] as Date)).toBe(7);
  });

  it('falls back to 30 days for an unknown window', async () => {
    const { useCase, getSignals } = buildUseCase();

    await useCase.execute('all-time');

    expect(daysAgo(getSignals.mock.calls[0][0] as Date)).toBe(30);
  });
});
