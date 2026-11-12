import { post } from './api';

const UNAUTHORIZED = 401;
const OK = 200;

const readErrorMessage = async (
  response: Response | undefined
): Promise<string> => {
  const fallback = response?.statusText || 'Unknown error';
  return response
    ? response
        .json()
        .then((body: { message?: string }) => body?.message ?? fallback)
        .catch(() => fallback)
    : fallback;
};

export const resumeSubscription = async (): Promise<{ message: string }> => {
  const response = await post('/api/users/resume-subscription', {});

  if (response?.status === UNAUTHORIZED) {
    globalThis.location.href = '/login';
    throw new Error('Authentication required');
  }

  if (response?.status !== OK) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
};
