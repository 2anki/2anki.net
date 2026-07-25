import express from 'express';

import OpsController from './OpsController';
import { GetOpsMetricsUseCase } from '../usecases/ops/GetOpsMetricsUseCase';
import { GetBusinessMetricsUseCase } from '../usecases/ops/GetBusinessMetricsUseCase';
import { GetReturnRateMetricsUseCase } from '../usecases/ops/GetReturnRateMetricsUseCase';
import { DeleteInactiveUsersUseCase } from '../usecases/ops/DeleteInactiveUsersUseCase';
import { GetLandingPageYieldUseCase } from '../usecases/ops/GetLandingPageYieldUseCase';
import { GetCustomerSignalsUseCase } from '../usecases/ops/GetCustomerSignalsUseCase';
import { GetPassUnlockMonitorUseCase } from '../usecases/ops/GetPassUnlockMonitorUseCase';
import { GetCancelFunnelUseCase } from '../usecases/ops/GetCancelFunnelUseCase';

const buildRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    json,
    status,
    end: jest.fn(),
    set: jest.fn(),
  } as unknown as express.Response & {
    json: jest.Mock;
    status: jest.Mock;
    set: jest.Mock;
  };
};

describe('OpsController.getMetrics', () => {
  it('passes the query window down to the use case and returns its result', async () => {
    const fakeMetrics = { window: '24h' };
    const useCase = {
      execute: jest.fn().mockResolvedValue(fakeMetrics),
    } as unknown as GetOpsMetricsUseCase;
    const controller = new OpsController(useCase);
    const req = { query: { window: '24h' } } as unknown as express.Request;
    const res = buildRes();

    await controller.getMetrics(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith('24h');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fakeMetrics);
  });

  it('responds 500 when the use case throws', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as GetOpsMetricsUseCase;
    const controller = new OpsController(useCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getMetrics(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    errSpy.mockRestore();
  });
});

describe('OpsController.getBusinessMetrics', () => {
  it('returns the use case result with status 200', async () => {
    const fake = { mrr_usd: 4820 };
    const opsUseCase = {} as unknown as GetOpsMetricsUseCase;
    const businessUseCase = {
      execute: jest.fn().mockResolvedValue(fake),
    } as unknown as GetBusinessMetricsUseCase;
    const controller = new OpsController(opsUseCase, businessUseCase);
    const req = {} as unknown as express.Request;
    const res = buildRes();

    await controller.getBusinessMetrics(req, res);

    expect(businessUseCase.execute as jest.Mock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fake);
  });

  it('responds 500 when the use case throws', async () => {
    const opsUseCase = {} as unknown as GetOpsMetricsUseCase;
    const businessUseCase = {
      execute: jest.fn().mockRejectedValue(new Error('stripe down')),
    } as unknown as GetBusinessMetricsUseCase;
    const controller = new OpsController(opsUseCase, businessUseCase);
    const req = {} as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getBusinessMetrics(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    errSpy.mockRestore();
  });
});

describe('OpsController.getReturnRateMetrics', () => {
  it('returns 500 when the use case is not configured', async () => {
    const opsUseCase = {} as unknown as GetOpsMetricsUseCase;
    const controller = new OpsController(opsUseCase);
    const req = {} as unknown as express.Request;
    const res = buildRes();

    await controller.getReturnRateMetrics(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('returns 200 with the use case result', async () => {
    const fakeResult = {
      overall: { '7d': 21, '14d': 34, '30d': 48 },
      by_source_type: [
        {
          source_type: 'page',
          cohort_size: 100,
          returned_7d: 21,
          returned_14d: 34,
          returned_30d: 48,
          return_rate_7d_pct: 21,
          return_rate_14d_pct: 34,
          return_rate_30d_pct: 48,
        },
      ],
      as_of: '2026-05-25T00:00:00.000Z',
    };
    const opsUseCase = {} as unknown as GetOpsMetricsUseCase;
    const returnRateUseCase = {
      execute: jest.fn().mockResolvedValue(fakeResult),
    } as unknown as GetReturnRateMetricsUseCase;
    const controller = new OpsController(
      opsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      returnRateUseCase
    );
    const req = {} as unknown as express.Request;
    const res = buildRes();

    await controller.getReturnRateMetrics(req, res);

    expect(returnRateUseCase.execute as jest.Mock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });

  it('responds 500 when the use case throws', async () => {
    const opsUseCase = {} as unknown as GetOpsMetricsUseCase;
    const returnRateUseCase = {
      execute: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as GetReturnRateMetricsUseCase;
    const controller = new OpsController(
      opsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      returnRateUseCase
    );
    const req = {} as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getReturnRateMetrics(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    errSpy.mockRestore();
  });
});

describe('OpsController.getLandingPageYield', () => {
  const buildController = (useCase?: GetLandingPageYieldUseCase) =>
    new OpsController(
      {} as unknown as GetOpsMetricsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      useCase
    );

  it('passes the window down and returns the payload', async () => {
    const payload = {
      pages: [
        {
          origin: '/pdf-to-anki',
          signups: 200,
          subscription_conversions: 30,
          pass_conversions: 10,
          paid_conversion_rate_pct: 18,
        },
      ],
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-07-01T00:00:00.000Z',
    };
    const useCase = {
      execute: jest.fn().mockResolvedValue(payload),
    } as unknown as GetLandingPageYieldUseCase;
    const controller = buildController(useCase);
    const req = { query: { window: '60d' } } as unknown as express.Request;
    const res = buildRes();

    await controller.getLandingPageYield(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith('60d');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('responds 503 when the use case is not configured', async () => {
    const controller = buildController(undefined);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();

    await controller.getLandingPageYield(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('responds 500 when the use case throws', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as GetLandingPageYieldUseCase;
    const controller = buildController(useCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getLandingPageYield(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    errSpy.mockRestore();
  });
});

describe('OpsController.getCustomerSignals', () => {
  const buildController = (useCase?: GetCustomerSignalsUseCase) =>
    new OpsController(
      {} as unknown as GetOpsMetricsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      useCase
    );

  it('passes the window down and returns the payload', async () => {
    const payload = {
      signals: [
        {
          source: 'failed_conversion',
          label: 'Notion export unreadable',
          count: 12,
          bucket: 'pain-killer',
        },
      ],
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-07-01T00:00:00.000Z',
    };
    const useCase = {
      execute: jest.fn().mockResolvedValue(payload),
    } as unknown as GetCustomerSignalsUseCase;
    const controller = buildController(useCase);
    const req = { query: { window: '7d' } } as unknown as express.Request;
    const res = buildRes();

    await controller.getCustomerSignals(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith('7d');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('responds 503 when the use case is not configured', async () => {
    const controller = buildController(undefined);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();

    await controller.getCustomerSignals(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('responds 500 when the use case throws', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as GetCustomerSignalsUseCase;
    const controller = buildController(useCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getCustomerSignals(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    errSpy.mockRestore();
  });
});

describe('OpsController.getPassUnlockMonitor', () => {
  const buildController = (useCase?: GetPassUnlockMonitorUseCase) =>
    new OpsController(
      {} as unknown as GetOpsMetricsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      useCase
    );

  it('passes the window down and returns the payload', async () => {
    const payload = {
      window_since: '2026-07-07T00:00:00.000Z',
      as_of: '2026-07-14T00:00:00.000Z',
      grace_minutes: 15,
      checked: 3,
      granted: 2,
      missing: 1,
      pending: 0,
      missingPayments: [
        {
          sessionId: 'cs_1',
          paymentIntentId: 'pi_1',
          kind: '24h',
          anonymous: false,
          createdAt: '2026-07-10T00:00:00.000Z',
          amountTotal: 199,
          currency: 'usd',
        },
      ],
    };
    const useCase = {
      execute: jest.fn().mockResolvedValue(payload),
    } as unknown as GetPassUnlockMonitorUseCase;
    const controller = buildController(useCase);
    const req = { query: { window: '30d' } } as unknown as express.Request;
    const res = buildRes();

    await controller.getPassUnlockMonitor(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith('30d');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('responds 503 when the use case is not configured', async () => {
    const controller = buildController(undefined);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();

    await controller.getPassUnlockMonitor(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('responds 500 when the use case throws', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new Error('stripe down')),
    } as unknown as GetPassUnlockMonitorUseCase;
    const controller = buildController(useCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getPassUnlockMonitor(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    errSpy.mockRestore();
  });
});

describe('OpsController.deleteInactiveUsers', () => {
  const buildController = (useCase: DeleteInactiveUsersUseCase) =>
    new OpsController(
      {} as unknown as GetOpsMetricsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      useCase
    );

  it('defaults to a dry run when dryRun is not specified', async () => {
    const useCase = {
      execute: jest.fn().mockResolvedValue({ count: 5, dryRun: true }),
    } as unknown as DeleteInactiveUsersUseCase;
    const controller = buildController(useCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();

    await controller.deleteInactiveUsers(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith(true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ count: 5, dryRun: true });
  });

  it('deletes for real only when dryRun=false is passed', async () => {
    const useCase = {
      execute: jest.fn().mockResolvedValue({ count: 3, dryRun: false }),
    } as unknown as DeleteInactiveUsersUseCase;
    const controller = buildController(useCase);
    const req = { query: { dryRun: 'false' } } as unknown as express.Request;
    const res = buildRes();

    await controller.deleteInactiveUsers(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith(false);
  });

  it('returns 500 when the use case is not configured', async () => {
    const controller = new OpsController({} as unknown as GetOpsMetricsUseCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();

    await controller.deleteInactiveUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });
});

describe('OpsController.getCancelFunnel', () => {
  const buildController = (useCase?: GetCancelFunnelUseCase) =>
    new OpsController(
      {} as unknown as GetOpsMetricsUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      useCase
    );

  it('passes the window down and returns the funnel payload', async () => {
    const payload = {
      stages: {
        cancel_started: 100,
        pause_offered: 40,
        paused: 12,
        cancelled: 70,
        pause_offer_declined: 25,
      },
      save_rate_pct: 30,
      offer_reach_pct: 40,
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-07-01T00:00:00.000Z',
    };
    const useCase = {
      execute: jest.fn().mockResolvedValue(payload),
    } as unknown as GetCancelFunnelUseCase;
    const controller = buildController(useCase);
    const req = { query: { window: '14d' } } as unknown as express.Request;
    const res = buildRes();

    await controller.getCancelFunnel(req, res);

    expect(useCase.execute as jest.Mock).toHaveBeenCalledWith('14d');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('responds 500 when the use case is not configured', async () => {
    const controller = buildController(undefined);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();

    await controller.getCancelFunnel(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('responds 500 when the use case throws', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as GetCancelFunnelUseCase;
    const controller = buildController(useCase);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRes();
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await controller.getCancelFunnel(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    errSpy.mockRestore();
  });
});
