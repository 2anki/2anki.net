const send = jest.fn().mockResolvedValue([{ statusCode: 202 }, {}]);

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send,
}));

import { getDefaultEmailService } from './EmailService';
import {
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
