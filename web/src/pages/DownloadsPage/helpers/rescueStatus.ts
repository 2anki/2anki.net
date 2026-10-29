export type RescueStatus =
  | { kind: 'building' }
  | { kind: 'limit'; limit: number }
  | { kind: 'oneAtATime' }
  | { kind: 'alreadyRunning' }
  | { kind: 'failed' };

const CONFLICT = 409;
const PAYMENT_REQUIRED = 402;

async function readReason(response: Response): Promise<{
  reason?: unknown;
  limit?: unknown;
}> {
  try {
    const body: unknown = await response.json();
    return body != null && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

// What a rescue re-run's response means for the line under the offer. A 2xx
// means the conversion started, so there is nothing to say: the row refreshes
// into its in-progress state.
export async function rescueStatusFromResponse(
  response: Response
): Promise<RescueStatus | null> {
  if (response.ok) {
    return null;
  }
  if (response.status === CONFLICT) {
    return { kind: 'alreadyRunning' };
  }
  if (response.status === PAYMENT_REQUIRED) {
    const body = await readReason(response);
    if (body.reason === 'monthly_limit' && typeof body.limit === 'number') {
      return { kind: 'limit', limit: body.limit };
    }
    return { kind: 'oneAtATime' };
  }
  return { kind: 'failed' };
}
