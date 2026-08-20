export interface GrantUnclaimedPassResponse {
  granted: boolean;
  userId: number;
  kind: string;
  expiresAt: string;
}

export async function grantUnclaimedPass(
  anonymousPassId: number,
  email: string
): Promise<GrantUnclaimedPassResponse> {
  const response = await fetch('/api/ops/grant-unclaimed-pass', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anonymousPassId, email }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
