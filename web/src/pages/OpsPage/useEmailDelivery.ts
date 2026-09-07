import { useQuery } from '@tanstack/react-query';

import {
  EmailDeliveryResponse,
  EmailDeliveryWindow,
} from './emailDeliveryTypes';

const REFRESH_MS = 60_000;

const fetchEmailDelivery = async (
  window: EmailDeliveryWindow
): Promise<EmailDeliveryResponse> => {
  const response = await fetch(`/api/ops/email-delivery?window=${window}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
};

export const useEmailDelivery = (window: EmailDeliveryWindow) => {
  return useQuery<EmailDeliveryResponse, Error>({
    queryKey: ['ops-email-delivery', window],
    queryFn: () => fetchEmailDelivery(window),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
  });
};
