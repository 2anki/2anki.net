type SubscribeError = Error & { status?: number };

interface ErrorLink {
  href: string;
  labelKey: string;
}

interface MappedError {
  textKey: string;
  link?: ErrorLink;
}

const KEY_PREFIX = 'subscriptions.subscribeError';

const FALLBACK: MappedError = {
  textKey: `${KEY_PREFIX}.fallback`,
};

export function mapSubscribeError(error: SubscribeError): MappedError {
  const { status, message } = error;

  if (status === 401 || status === 403) {
    return {
      textKey: `${KEY_PREFIX}.notActive`,
      link: { href: '/account', labelKey: `${KEY_PREFIX}.notActiveLink` },
    };
  }

  if (status === 409) {
    if (message.includes('Notion is not connected')) {
      return {
        textKey: `${KEY_PREFIX}.notionDisconnected`,
        link: {
          href: '/notion',
          labelKey: `${KEY_PREFIX}.notionDisconnectedLink`,
        },
      };
    }
    if (message.includes('No active Ankify client')) {
      return {
        textKey: `${KEY_PREFIX}.noClient`,
        link: { href: '/ankify/setup', labelKey: `${KEY_PREFIX}.noClientLink` },
      };
    }
    return FALLBACK;
  }

  if (status === 503) {
    return { textKey: `${KEY_PREFIX}.ankiUnreachable` };
  }

  return FALLBACK;
}
