export type PruneDeadUploadsResponse =
  | { dryRun: true; missingRows: number; sampleKeys: string[] }
  | { dryRun: false; deleted: number };

export async function pruneDeadUploads(
  dryRun: boolean
): Promise<PruneDeadUploadsResponse> {
  const response = await fetch('/api/ops/prune-dead-uploads', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
