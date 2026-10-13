import { EditPayload } from './cardEditTypes';

export async function downloadEditedApkg(
  key: string,
  edits: EditPayload[]
): Promise<void> {
  const response = await fetch(
    `/api/apkg/${encodeURIComponent(key)}/download-edited`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/octet-stream',
      },
      body: JSON.stringify({ edits }),
    }
  );
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ message: response.statusText }));
    // The status lets reportClientError skip a 4xx: an upload that expired
    // while the preview tab sat open is expected, not a bug to investigate.
    throw Object.assign(new Error(err.message ?? 'Download failed.'), {
      status: response.status,
    });
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = disposition.match(
    /filename[^;=\n]*=(?:["']?)([^"';\n]+)/i
  );
  const filename =
    filenameMatch?.[1]?.trim() ?? key.replace(/\.apkg$/i, '-edited.apkg');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
