export async function markOnboarded(): Promise<void> {
  try {
    await fetch('/api/users/me/onboarded', {
      method: 'PATCH',
      credentials: 'include',
    });
  } catch {
    // silent — onboarded_at stays null and the next fresh visit retries
  }
}
