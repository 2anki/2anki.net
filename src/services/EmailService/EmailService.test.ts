const send = jest.fn().mockResolvedValue([{ statusCode: 202 }, {}]);

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send,
}));

import {
  getDefaultEmailService,
  IEmailService,
  UnimplementedEmailService,
} from './EmailService';
import {
  EMAIL_CATEGORIES,
  NOTION_RECONNECT_TEMPLATE,
  CONTACT_CONFIRMATION_TEMPLATE,
} from './constants';

describe('EmailService.sendNotionReconnectEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastMessage() {
    const calls = send.mock.calls;
    return calls[calls.length - 1][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
  }

  it('loads the notion-reconnect template without error', () => {
    expect(NOTION_RECONNECT_TEMPLATE).toContain('Reconnect Notion');
    expect(NOTION_RECONNECT_TEMPLATE).toContain('{{ctaUrl}}');
    expect(NOTION_RECONNECT_TEMPLATE).toContain(
      '2anki.net/mascot/navbar-logo.png'
    );
  });

  it('sends with the correct subject and recipient', async () => {
    const service = getDefaultEmailService();

    await service.sendNotionReconnectEmail('user@example.com');

    const msg = lastMessage();
    expect(msg.to).toBe('user@example.com');
    expect(msg.subject).toBe('Your Notion connection expired');
  });

  it('replaces {{ctaUrl}} with the Notion reconnect URL', async () => {
    const service = getDefaultEmailService();

    await service.sendNotionReconnectEmail('user@example.com');

    const msg = lastMessage();
    expect(msg.html).toContain('https://2anki.net/notion');
    expect(msg.html).not.toContain('{{ctaUrl}}');
  });

  it('includes the expected body copy', async () => {
    const service = getDefaultEmailService();

    await service.sendNotionReconnectEmail('user@example.com');

    const msg = lastMessage();
    expect(msg.html).toContain('2anki lost access to your Notion workspace');
    expect(msg.html).toContain('Reconnect Notion');
    expect(msg.html).toContain('The 2anki Team');
    expect(msg.html).not.toContain('unsubscribe');
  });
});

describe('EmailService.sendAbandonedCheckoutRecoveryEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastMessage() {
    const calls = send.mock.calls;
    return calls[calls.length - 1][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
  }

  it('links the CTA to the checkout resume endpoint with the token', async () => {
    const service = getDefaultEmailService();

    await service.sendAbandonedCheckoutRecoveryEmail(
      'buyer@example.com',
      'tok-abc-123'
    );

    const msg = lastMessage();
    expect(msg.html).toContain(
      'https://2anki.net/checkout/resume?token=tok-abc-123'
    );
    expect(msg.html).not.toContain('{{link}}');
  });

  it('keeps the unsubscribe link', async () => {
    const service = getDefaultEmailService();

    await service.sendAbandonedCheckoutRecoveryEmail(
      'buyer@example.com',
      'tok-abc-123'
    );

    const msg = lastMessage();
    expect(msg.html).toContain('https://2anki.net/unsubscribe?uid=tok-abc-123');
    expect(msg.html).not.toContain('{{unsubscribeUrl}}');
  });
});

describe('EmailService conversion emails name the deck and count', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastMessage() {
    const calls = send.mock.calls;
    return calls[calls.length - 1][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
  }

  it('renders the deck name and card count in the attachment email', async () => {
    const service = getDefaultEmailService();

    await service.sendConversionEmail(
      'learner@example.com',
      'Organic Chemistry Ch. 4',
      Buffer.from('apkg'),
      34
    );

    const msg = lastMessage();
    expect(msg.html).toContain('Organic Chemistry Ch. 4');
    expect(msg.html).toContain('34 cards');
    expect(msg.html).not.toContain('{{deckName}}');
    expect(msg.html).not.toContain('{{cardCountSuffix}}');
    expect(msg.text).toBe(
      'Your deck is ready: Organic Chemistry Ch. 4 — 34 cards. It is attached to this email.'
    );
  });

  it('renders the deck name, card count, and link in the link email', async () => {
    const service = getDefaultEmailService();

    await service.sendConversionLinkEmail(
      'learner@example.com',
      'Biochemistry',
      'https://2anki.net/api/download/u/key-1',
      1
    );

    const msg = lastMessage();
    expect(msg.html).toContain('Biochemistry');
    expect(msg.html).toContain('1 card');
    expect(msg.html).toContain('https://2anki.net/api/download/u/key-1');
    expect(msg.html).not.toContain('{{link}}');
    expect(msg.text).toContain('Your deck is ready: Biochemistry — 1 card');
  });

  it('omits the count clause when card count is absent', async () => {
    const service = getDefaultEmailService();

    await service.sendConversionEmail(
      'learner@example.com',
      'History Notes',
      Buffer.from('apkg')
    );

    const msg = lastMessage();
    expect(msg.html).toContain('History Notes');
    expect(msg.html).not.toContain('{{cardCountSuffix}}');
    expect(msg.html).not.toContain('undefined');
    expect(msg.html).not.toContain('History Notes —');
    expect(msg.text).toBe(
      'Your deck is ready: History Notes. It is attached to this email.'
    );
  });

  it('falls back to Untitled deck for an empty name', async () => {
    const service = getDefaultEmailService();

    await service.sendConversionEmail(
      'learner@example.com',
      '   ',
      Buffer.from('apkg'),
      12
    );

    const msg = lastMessage();
    expect(msg.html).toContain('Untitled deck');
    expect(msg.text).toBe(
      'Your deck is ready: Untitled deck — 12 cards. It is attached to this email.'
    );
  });

  it('escapes HTML in the deck name', async () => {
    const service = getDefaultEmailService();

    await service.sendConversionEmail(
      'learner@example.com',
      '<script>alert(1)</script>',
      Buffer.from('apkg'),
      3
    );

    const msg = lastMessage();
    expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(msg.html).not.toContain('<script>alert(1)</script>');
  });

  it('groups large card counts with a thin space', async () => {
    const service = getDefaultEmailService();

    await service.sendConversionEmail(
      'learner@example.com',
      'Big Deck',
      Buffer.from('apkg'),
      12450
    );

    const msg = lastMessage();
    expect(msg.html).toContain('12 450 cards');
  });
});

describe('EmailService support notifications cc the owner', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastMessage() {
    const calls = send.mock.calls;
    return calls[calls.length - 1][0] as {
      to: string;
      cc?: string;
      replyTo?: string;
    };
  }

  it('ccs the owner on Auto Sync access requests', async () => {
    const service = getDefaultEmailService();

    await service.sendHostedAnkiAccessRequestEmail('21770', 'user@example.com');

    const msg = lastMessage();
    expect(msg.to).toBe('support@2anki.net');
    expect(msg.cc).toBe('alexander@alemayhu.com');
  });

  it('ccs the owner on contact form submissions', async () => {
    const service = getDefaultEmailService();

    await service.sendContactEmail('Ada', 'user@example.com', 'Hello', []);

    const msg = lastMessage();
    expect(msg.to).toBe('support@2anki.net');
    expect(msg.cc).toBe('alexander@alemayhu.com');
  });

  it('ccs the owner on parser canary alerts', async () => {
    const service = getDefaultEmailService();

    await service.sendParserCanaryAlert(
      'support@2anki.net',
      'fixture count mismatch'
    );

    const msg = lastMessage();
    expect(msg.to).toBe('support@2anki.net');
    expect(msg.cc).toBe('alexander@alemayhu.com');
  });
});

describe('EmailService.sendContactConfirmationEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastMessage() {
    const calls = send.mock.calls;
    return calls[calls.length - 1][0] as {
      to: string;
      subject: string;
      html: string;
      replyTo: string;
    };
  }

  it('loads the contact-confirmation template with the required blocks', () => {
    expect(CONTACT_CONFIRMATION_TEMPLATE).toContain(
      '2anki.net/mascot/navbar-logo.png'
    );
    expect(CONTACT_CONFIRMATION_TEMPLATE).toContain('prefers-color-scheme');
    expect(CONTACT_CONFIRMATION_TEMPLATE).toContain('The 2anki Team');
    expect(CONTACT_CONFIRMATION_TEMPLATE).toContain(
      'Turn what you study into Anki flashcards'
    );
    expect(CONTACT_CONFIRMATION_TEMPLATE).not.toContain('unsubscribe');
    expect(CONTACT_CONFIRMATION_TEMPLATE).not.toContain('{{');
  });

  it('sends to the submitter with replies routed to support', async () => {
    const service = getDefaultEmailService();

    await service.sendContactConfirmationEmail('user@example.com');

    const msg = lastMessage();
    expect(msg.to).toBe('user@example.com');
    expect(msg.subject).toBe('We got your message');
    expect(msg.replyTo).toBe('support@2anki.net');
    expect(msg.html).toContain('Your message reached us');
  });
});

describe('EmailService.sendConversionLinkEmail delivery contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns an awaitable promise whose resolution follows delivery', async () => {
    const service = getDefaultEmailService();

    const returned = service.sendConversionLinkEmail(
      'learner@example.com',
      'Anatomy',
      'https://2anki.net/api/download/u/key-9',
      2
    );

    expect(returned).toBeInstanceOf(Promise);
    await returned;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lets the unimplemented service be awaited without delivering', async () => {
    const service = new UnimplementedEmailService();

    const returned = service.sendConversionLinkEmail(
      'learner@example.com',
      'Anatomy',
      'https://2anki.net/api/download/u/key-9',
      2
    );

    await returned;
    expect(send).not.toHaveBeenCalled();
  });
});

describe('EMAIL_CATEGORIES slugs', () => {
  it('defines a unique non-empty kebab-case slug for every category', () => {
    const slugs = Object.values(EMAIL_CATEGORIES);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('EmailService tags every outgoing send with a template category', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.DOMAIN = 'https://2anki.net';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastCategories(): string[] | undefined {
    const calls = send.mock.calls;
    if (calls.length === 0) {
      return undefined;
    }
    return (calls[calls.length - 1][0] as { categories?: string[] }).categories;
  }

  const cases: {
    category: string;
    run: (s: IEmailService) => Promise<void>;
  }[] = [
    {
      category: EMAIL_CATEGORIES.passwordReset,
      run: (s) => s.sendResetEmail('user@example.com', 'tok'),
    },
    {
      category: EMAIL_CATEGORIES.deckReady,
      run: async (s) => {
        await s.sendConversionEmail(
          'user@example.com',
          'Deck',
          Buffer.from('apkg'),
          3
        );
      },
    },
    {
      category: EMAIL_CATEGORIES.deckReadyLink,
      run: (s) =>
        s.sendConversionLinkEmail(
          'user@example.com',
          'Deck',
          'https://2anki.net/api/download/u/key-1',
          3
        ),
    },
    {
      category: EMAIL_CATEGORIES.contactForm,
      run: async (s) => {
        await s.sendContactEmail('Ada', 'user@example.com', 'Hi', []);
      },
    },
    {
      category: EMAIL_CATEGORIES.autoSyncAccessRequest,
      run: async (s) => {
        await s.sendHostedAnkiAccessRequestEmail('21770', 'user@example.com');
      },
    },
    {
      category: EMAIL_CATEGORIES.magicLinkLogin,
      run: async (s) => {
        await s.sendMagicLinkEmail('user@example.com', 'tok', 'login');
      },
    },
    {
      category: EMAIL_CATEGORIES.magicLinkPasswordReset,
      run: async (s) => {
        await s.sendMagicLinkEmail('user@example.com', 'tok', 'password_reset');
      },
    },
    {
      category: EMAIL_CATEGORIES.reEngagement,
      run: (s) => s.sendReEngagementEmail('user@example.com', 'Ada', 'tok'),
    },
    {
      category: EMAIL_CATEGORIES.inactivityWarning,
      run: (s) => s.sendInactivityWarningEmail('user@example.com', 'tok'),
    },
    {
      category: EMAIL_CATEGORIES.abandonedCheckoutRecovery,
      run: (s) =>
        s.sendAbandonedCheckoutRecoveryEmail('user@example.com', 'tok'),
    },
    {
      category: EMAIL_CATEGORIES.passWinback,
      run: (s) => s.sendPassWinbackEmail('user@example.com', 'tok'),
    },
    {
      category: EMAIL_CATEGORIES.subscriptionClaim,
      run: (s) =>
        s.sendSubscriptionClaimConfirmation(
          'user@example.com',
          'https://2anki.net/claim'
        ),
    },
    {
      category: EMAIL_CATEGORIES.contactConfirmation,
      run: (s) => s.sendContactConfirmationEmail('user@example.com'),
    },
    {
      category: EMAIL_CATEGORIES.passClaim,
      run: (s) =>
        s.sendPassClaimConfirmation(
          'user@example.com',
          'https://2anki.net/claim',
          'weekly pass'
        ),
    },
    {
      category: EMAIL_CATEGORIES.anonymousPassClaim,
      run: (s) =>
        s.sendAnonymousPassClaimEmail(
          'user@example.com',
          'https://2anki.net/claim',
          'weekly pass'
        ),
    },
    {
      category: EMAIL_CATEGORIES.subscriptionScheduledCancellation,
      run: (s) =>
        s.sendSubscriptionScheduledCancellationEmail(
          'user@example.com',
          'Ada',
          new Date('2026-10-01')
        ),
    },
    {
      category: EMAIL_CATEGORIES.subscriptionResumingSoon,
      run: (s) =>
        s.sendSubscriptionResumingSoonEmail(
          'user@example.com',
          new Date('2026-10-01'),
          '$7.99'
        ),
    },
    {
      category: EMAIL_CATEGORIES.parserCanary,
      run: (s) => s.sendParserCanaryAlert('support@2anki.net', 'mismatch'),
    },
    {
      category: EMAIL_CATEGORIES.notionReconnect,
      run: (s) => s.sendNotionReconnectEmail('user@example.com'),
    },
    {
      category: EMAIL_CATEGORIES.priceLockIn,
      run: (s) => s.sendPriceLockInEmail('user@example.com', 'tok', 'a'),
    },
    {
      category: EMAIL_CATEGORIES.subscriptionRecovery,
      run: (s) =>
        s.sendSubscriptionRecoveryEmail('user@example.com', 'paid@example.com'),
    },
  ];

  it('returns undefined categories when no email was sent', () => {
    expect(lastCategories()).toBeUndefined();
  });

  it.each(cases)('tags $category on the send', async ({ category, run }) => {
    const service = getDefaultEmailService();

    await run(service);

    expect(lastCategories()).toEqual([category]);
  });

  it('tags the subscription-cancelled email with its category', async () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const service = getDefaultEmailService();

    await service.sendSubscriptionCancelledEmail(
      'user@example.com',
      'Ada',
      'sub_test_123'
    );

    expect(lastCategories()).toEqual([EMAIL_CATEGORIES.subscriptionCancelled]);
  });
});
