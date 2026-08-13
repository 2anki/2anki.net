import axios from 'axios';

import instrumentedAxios from '../../observability/instrumentedAxios';

const isExpiredOrMissing = (status: number | undefined): boolean =>
  status === 403 || status === 404;

export async function downloadMediaOrSkip(url: string): Promise<Buffer | null> {
  if (url.startsWith('data:')) {
    const commaIndex = url.indexOf(',');
    if (commaIndex < 0) return null;
    const payload = url.slice(commaIndex + 1);
    const isBase64 = url.slice(0, commaIndex).includes(';base64');
    return Buffer.from(payload, isBase64 ? 'base64' : 'utf-8');
  }

  try {
    const response = await instrumentedAxios.get<Buffer>('notion', url, {
      responseType: 'arraybuffer',
    });
    return response.data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      isExpiredOrMissing(error.response?.status)
    ) {
      return null;
    }
    throw error;
  }
}
