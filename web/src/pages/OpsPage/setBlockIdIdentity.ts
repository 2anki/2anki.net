export interface SetBlockIdIdentityResponse {
  userId: number;
  blockIdIdentity: boolean;
}

export async function setBlockIdIdentity(
  email: string,
  enabled: boolean
): Promise<SetBlockIdIdentityResponse> {
  const response = await fetch('/api/ops/set-block-id-identity', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, enabled }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
