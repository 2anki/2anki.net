export interface SendPassWinbackResponse {
  campaign: string;
  count: number;
  dryRun: boolean;
}

export async function sendPassWinback(
  campaign: string,
  dryRun: boolean
): Promise<SendPassWinbackResponse> {
  const response = await fetch(
    `/api/ops/send-pass-winback?campaign=${encodeURIComponent(campaign)}&dryRun=${dryRun}`,
    { method: 'POST', credentials: 'include' }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
