export async function fetchOpsJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      body.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json() as Promise<T>;
}
