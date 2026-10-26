export interface DeleteUserAccount {
  userId: number;
  createdAt: string | null;
  lastLoginAt: string | null;
  activeSubscription: boolean;
  activePass: { kind: string; expiresAt: string } | null;
  jobs: number;
  uploads: number;
}

export type DeleteUserResult =
  | { dryRun: true; account: DeleteUserAccount }
  | { dryRun: false; userId: number };

export class DeleteUserError extends Error {
  constructor(
    message: string,
    readonly account?: DeleteUserAccount
  ) {
    super(message);
    this.name = 'DeleteUserError';
  }
}

export async function deleteUser(params: {
  email: string;
  dryRun: boolean;
  confirmEmail?: string;
  force?: boolean;
}): Promise<DeleteUserResult> {
  const response = await fetch('/api/ops/delete-user', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new DeleteUserError(
      data.message ?? `${response.status} ${response.statusText}`,
      data.account
    );
  }
  return response.json();
}
