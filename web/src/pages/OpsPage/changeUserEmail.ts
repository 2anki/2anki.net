export interface ChangeUserEmailResponse {
  userId: number;
}

export async function changeUserEmail(
  currentEmail: string,
  newEmail: string
): Promise<ChangeUserEmailResponse> {
  const response = await fetch('/api/ops/change-user-email', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentEmail, newEmail }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
