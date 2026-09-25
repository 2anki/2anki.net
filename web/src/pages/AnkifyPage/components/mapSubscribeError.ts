type SubscribeError = Error & { status?: number };

interface ErrorLink {
  href: string;
  label: string;
}

interface MappedError {
  text: string;
  link?: ErrorLink;
}

const FALLBACK: MappedError = {
  text: 'Something broke on our end. Try again, or email support@2anki.net.',
};

export function mapSubscribeError(error: SubscribeError): MappedError {
  const { status, message } = error;

  if (status === 401 || status === 403) {
    return {
      text: "Auto Sync isn't active on this account.",
      link: { href: '/account', label: 'Manage subscription' },
    };
  }

  if (status === 409) {
    if (message.includes('Notion is not connected')) {
      return {
        text: "Notion isn't connected to 2anki.",
        link: { href: '/notion', label: 'Connect Notion' },
      };
    }
    if (message.includes('No active Ankify client')) {
      return {
        text: "Your hosted Anki isn't set up yet.",
        link: { href: '/ankify/setup', label: 'Set up Anki' },
      };
    }
    return FALLBACK;
  }

  if (status === 503) {
    return { text: "Anki isn't responding right now. Try again in a moment." };
  }

  return FALLBACK;
}
