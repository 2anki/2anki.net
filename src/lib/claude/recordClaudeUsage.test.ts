import { recordClaudeUsage } from './recordClaudeUsage';
import { track } from '../../services/events/track';

jest.mock('../../services/events/track', () => ({
  track: jest.fn(),
}));

const trackMock = track as jest.Mock;

describe('recordClaudeUsage', () => {
  beforeEach(() => {
    trackMock.mockReset();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tracks an ai_usage_recorded event with token counts nested under usage', () => {
    recordClaudeUsage({
      surface: 'chat',
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 200_000,
      },
      userId: 42,
      durationMs: 1234,
    });

    expect(trackMock).toHaveBeenCalledWith('ai_usage_recorded', {
      userId: 42,
      props: {
        surface: 'chat',
        model: 'claude-sonnet-5',
        cost_usd: 3 + 7.5 + 0.2 * 3 * 0.1,
        duration_ms: 1234,
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 500_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 200_000,
        },
      },
    });
  });

  it('logs a claude-usage line with surface, model, user, and cost', () => {
    recordClaudeUsage({
      surface: 'file_conversion',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining(
        '[claude-usage] surface=file_conversion model=claude-sonnet-5 user=anon input=100 output=50'
      )
    );
  });

  it('stamps the user id into the log line when provided', () => {
    recordClaudeUsage({
      surface: 'conversion',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 100, output_tokens: 50 },
      userId: 21770,
    });

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('user=21770 input=100')
    );
  });

  it('records nothing when usage is missing', () => {
    recordClaudeUsage({
      surface: 'chat',
      model: 'claude-sonnet-5',
      usage: null,
    });
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('never throws when the event sink is unavailable', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    trackMock.mockImplementation(() => {
      throw new Error('no database');
    });

    expect(() =>
      recordClaudeUsage({
        surface: 'chat',
        model: 'claude-sonnet-5',
        usage: { input_tokens: 1 },
      })
    ).not.toThrow();
  });
});
