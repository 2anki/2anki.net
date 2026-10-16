const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
// The webhook awaits this call before answering Stripe; a stalled GA4 must
// not push the response past Stripe's delivery timeout (which would trigger a
// redelivery and a second grant).
const GA4_TIMEOUT_MS = 5000;

interface PurchaseParams {
  transactionId: string;
  valueCents: number;
  currency: string;
  clientId: string;
  sessionId?: string;
}

interface SignUpParams {
  clientId: string;
  method: string;
  sessionId?: string;
}

// The Measurement Protocol carries api_secret in the request URL, so a failed
// request's error object (its message, cause or config) can hold the secret.
// Only the error class ever reaches the logs.
function errorName(error: unknown): string {
  const name = (error as { name?: unknown })?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'Error';
}

async function postEvent(
  url: string,
  body: Record<string, unknown>
): Promise<boolean> {
  try {
    await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(GA4_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return true;
  } catch (error) {
    console.error(`[ga4] send failed: ${errorName(error)}`);
    return false;
  }
}

function sessionParams(
  sessionId: string | undefined
): Record<string, string | number> {
  if (sessionId == null || sessionId === '') {
    return {};
  }
  return { session_id: sessionId, engagement_time_msec: 1 };
}

export async function sendPurchaseEvent(params: PurchaseParams): Promise<void> {
  const apiSecret = process.env.GA4_API_SECRET;
  const measurementId = process.env.GA4_MEASUREMENT_ID;

  if (!apiSecret || !measurementId) {
    return;
  }

  const url = `${GA4_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`;

  const sent = await postEvent(url, {
    client_id: params.clientId,
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: params.transactionId,
          value: params.valueCents / 100,
          currency: params.currency.toUpperCase(),
          items: [],
          ...sessionParams(params.sessionId),
        },
      },
    ],
  });

  if (sent) {
    console.info(`[ga4] purchase sent ${params.transactionId}`);
  }
}

export async function sendSignUpEvent(params: SignUpParams): Promise<void> {
  const apiSecret = process.env.GA4_API_SECRET;
  const measurementId = process.env.GA4_MEASUREMENT_ID;

  if (!apiSecret || !measurementId) {
    return;
  }

  const url = `${GA4_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`;

  const sent = await postEvent(url, {
    client_id: params.clientId,
    events: [
      {
        name: 'sign_up',
        params: {
          method: params.method,
          ...sessionParams(params.sessionId),
        },
      },
    ],
  });

  if (sent) {
    console.info('[ga4] sign_up sent');
  }
}
