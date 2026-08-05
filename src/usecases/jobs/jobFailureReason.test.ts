import { APIResponseError, APIErrorCode } from '@notionhq/client';
import { buildPythonExitError } from '../../lib/anki/buildPythonExitError';
import {
  ClaudeLargeSectionError,
  LARGE_SECTION_USER_MESSAGE,
} from '../../lib/claude/ClaudeService';
import { CONVERSION_TRUNCATED_MESSAGE } from '../../infrastracture/adapters/fileConversion/claudeFileConversion';
import { EmptyDeckError } from './EmptyDeckError';
import {
  COLUMNS_AMBIGUOUS_PREFIX,
  EMPTY_DECK_FAILURE_REASON,
  MARKDOWN_LIKELY_LOSSY_REASON,
  NOTION_TOKEN_EXPIRED_REASON,
  NOTION_DATABASE_NOT_PAGE_REASON,
  isNotionUnauthorizedError,
  jobFailureReasonCode,
  jobFailureReasonFromError,
} from './jobFailureReason';

function makeUnauthorizedError(): APIResponseError {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, {
    name: 'APIResponseError',
    message: 'Unauthorized',
    code: APIErrorCode.Unauthorized,
    status: 401,
  });
  return err;
}

function makeAPIResponseError(code: string, status: number): APIResponseError {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, { name: 'APIResponseError', message: code, code, status });
  return err;
}

describe('jobFailureReasonFromError', () => {
  it('returns the EmptyDeckError reason unchanged', () => {
    const reason = jobFailureReasonFromError(new EmptyDeckError(), 'job-1');
    expect(reason).toBe(EMPTY_DECK_FAILURE_REASON);
  });

  it('surfaces the actionable large-section message instead of a generic reason', () => {
    const reason = jobFailureReasonFromError(
      new ClaudeLargeSectionError(),
      'job-2'
    );
    expect(reason).toBe(LARGE_SECTION_USER_MESSAGE);
    expect(reason).not.toContain('Something went wrong');
    expect(jobFailureReasonCode(new ClaudeLargeSectionError())).toBe(
      'claude_large_section'
    );
  });

  it('keeps the ops-matched empty-deck prefix intact', () => {
    expect(
      EMPTY_DECK_FAILURE_REASON.startsWith('No cards in this deck yet.')
    ).toBe(true);
  });

  it('returns MARKDOWN_LIKELY_LOSSY_REASON for EmptyDeckError with markdown sourceFormat', () => {
    const reason = jobFailureReasonFromError(
      new EmptyDeckError('markdown'),
      'job-md'
    );
    expect(reason).toBe(MARKDOWN_LIKELY_LOSSY_REASON);
  });

  it('returns EMPTY_DECK_FAILURE_REASON for EmptyDeckError without sourceFormat', () => {
    const reason = jobFailureReasonFromError(new EmptyDeckError(), 'job-html');
    expect(reason).toBe(EMPTY_DECK_FAILURE_REASON);
  });

  it('returns the PythonExitError message verbatim (no "Technical error" prefix)', () => {
    const pythonError = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: "Unsupported 'data_source'!",
      jobId: 'job-py',
    });
    const reason = jobFailureReasonFromError(pythonError, 'job-py');
    expect(reason).toBe(pythonError.message);
    expect(reason).not.toMatch(/^Technical error/);
  });

  it('returns the generic fallback with job ID for an unknown error', () => {
    const reason = jobFailureReasonFromError(new Error('boom'), 'job-xyz');
    expect(reason).toContain('job-xyz');
    expect(reason).toContain('2anki.net/status');
    expect(reason).toContain('support@2anki.net');
  });

  it('encodes COLUMNS_AMBIGUOUS error with columns and suggested mapping', () => {
    const err = new Error('ambiguous') as Error & {
      code?: string;
      columns?: string[];
    };
    err.code = 'NOTION_DATABASE_COLUMNS_AMBIGUOUS';
    err.columns = ['Term', 'Definition', 'Notes'];
    const reason = jobFailureReasonFromError(err, 'job-amb');
    expect(reason.startsWith(COLUMNS_AMBIGUOUS_PREFIX)).toBe(true);
    const parsed = JSON.parse(
      reason.slice(COLUMNS_AMBIGUOUS_PREFIX.length)
    ) as {
      columns: string[];
      suggested: { frontField: string | null; backField: string | null };
    };
    expect(parsed.columns).toEqual(['Term', 'Definition', 'Notes']);
    expect(parsed.suggested.frontField).toBe('Term');
    expect(parsed.suggested.backField).toBe('Definition');
  });

  it('encodes COLUMNS_AMBIGUOUS with null suggestions when no canonical match', () => {
    const err = new Error('ambiguous') as Error & {
      code?: string;
      columns?: string[];
    };
    err.code = 'NOTION_DATABASE_COLUMNS_AMBIGUOUS';
    err.columns = ['Col1', 'Col2', 'Col3'];
    const reason = jobFailureReasonFromError(err, 'job-no-suggest');
    expect(reason.startsWith(COLUMNS_AMBIGUOUS_PREFIX)).toBe(true);
    const parsed = JSON.parse(
      reason.slice(COLUMNS_AMBIGUOUS_PREFIX.length)
    ) as {
      columns: string[];
      suggested: { frontField: string | null; backField: string | null };
    };
    expect(parsed.columns).toEqual(['Col1', 'Col2', 'Col3']);
    expect(parsed.suggested.frontField).toBeNull();
    expect(parsed.suggested.backField).toBeNull();
  });

  it('returns NOTION_TOKEN_EXPIRED_REASON for an APIResponseError with unauthorized code', () => {
    const reason = jobFailureReasonFromError(
      makeUnauthorizedError(),
      'job-unauth'
    );
    expect(reason).toBe(NOTION_TOKEN_EXPIRED_REASON);
  });

  it('isNotionUnauthorizedError returns true for an unauthorized APIResponseError', () => {
    expect(isNotionUnauthorizedError(makeUnauthorizedError())).toBe(true);
  });

  it('isNotionUnauthorizedError returns false for a non-unauthorized APIResponseError', () => {
    const err = Object.create(APIResponseError.prototype) as APIResponseError;
    Object.assign(err, {
      name: 'APIResponseError',
      message: 'Not Found',
      code: 'object_not_found',
      status: 404,
    });
    expect(isNotionUnauthorizedError(err)).toBe(false);
  });

  it('isNotionUnauthorizedError returns false for a plain Error', () => {
    expect(isNotionUnauthorizedError(new Error('boom'))).toBe(false);
  });

  it('never produces a string starting with "Technical error"', () => {
    const reasons = [
      jobFailureReasonFromError(new EmptyDeckError(), 'j1'),
      jobFailureReasonFromError(
        buildPythonExitError({
          code: 1,
          stdout: '',
          stderr:
            'UserWarning: Field contained the following invalid HTML tags',
          jobId: 'j2',
        }),
        'j2'
      ),
      jobFailureReasonFromError(
        buildPythonExitError({
          code: 137,
          stdout: '',
          stderr: '',
          jobId: 'j3',
        }),
        'j3'
      ),
      jobFailureReasonFromError(new Error('mystery'), 'j4'),
      jobFailureReasonFromError('string error', 'j5'),
      jobFailureReasonFromError(undefined, 'j6'),
    ];
    for (const reason of reasons) {
      expect(reason).not.toMatch(/^Technical error/);
    }
  });

  it('classifies PARSER_CRASH code as parser crash message', () => {
    const err = new Error('unexpected') as Error & { code?: string };
    err.code = 'PARSER_CRASH';
    const reason = jobFailureReasonFromError(err, 'job-pc');
    expect(reason).toContain('malformed or use a structure');
    expect(reason).toContain('support@2anki.net');
  });

  it('classifies WORKER_TIMEOUT error name as timeout message', () => {
    const err = new Error('timed out') as Error & { code?: string };
    err.code = 'WORKER_TIMEOUT';
    const reason = jobFailureReasonFromError(err, 'job-wt');
    expect(reason).toContain('time budget');
    expect(reason).toContain('smaller pieces');
  });

  it('classifies APIResponseError rate_limited as rate limit message', () => {
    const err = makeAPIResponseError(APIErrorCode.RateLimited, 429);
    const reason = jobFailureReasonFromError(err, 'job-rl');
    expect(reason).toContain('rate-limiting');
    expect(reason).toContain('Wait a minute');
  });

  it('classifies APIResponseError object_not_found as page not found message', () => {
    const err = makeAPIResponseError(APIErrorCode.ObjectNotFound, 404);
    const reason = jobFailureReasonFromError(err, 'job-nf');
    expect(reason).toContain("couldn't open that Notion page");
    expect(reason).toContain('Share it with the 2anki integration');
  });

  it('classifies a database-not-page validation_error as the database reason', () => {
    const err = {
      code: 'validation_error',
      message: 'x is a database, not a page',
    };
    expect(jobFailureReasonFromError(err, 'job-db')).toBe(
      NOTION_DATABASE_NOT_PAGE_REASON
    );
  });

  it('classifies APKG_TOO_LARGE code as size limit message', () => {
    const err = new Error('too large') as Error & { code?: string };
    err.code = 'APKG_TOO_LARGE';
    const reason = jobFailureReasonFromError(err, 'job-tl');
    expect(reason).toContain('100 MB');
    expect(reason).toContain('upload limit');
  });

  it('classifies ZIP_INVALID code as zip error message', () => {
    const err = new Error('bad zip') as Error & { code?: string };
    err.code = 'ZIP_INVALID';
    const reason = jobFailureReasonFromError(err, 'job-zi');
    expect(reason).toContain("Couldn't read this zip");
    expect(reason).toContain('Markdown & CSV export');
  });

  it('classifies pdfinfo_password error prefix as password-protected message', () => {
    const err = new Error('pdfinfo_password: encrypted');
    const reason = jobFailureReasonFromError(err, 'job-pp');
    expect(reason).toContain('password-protected');
    expect(reason).toContain('Remove the password');
  });

  it('generic fallback includes status link', () => {
    const reason = jobFailureReasonFromError(
      new Error('some unknown error'),
      'job-unk'
    );
    expect(reason).toContain('2anki.net/status');
  });
});

describe('jobFailureReasonCode', () => {
  function withCode(code: string): Error & { code?: string } {
    const err = new Error(code) as Error & { code?: string };
    err.code = code;
    return err;
  }

  it('maps EmptyDeckError to empty_deck', () => {
    expect(jobFailureReasonCode(new EmptyDeckError())).toBe('empty_deck');
  });

  it('maps markdown EmptyDeckError to markdown_likely_lossy', () => {
    expect(jobFailureReasonCode(new EmptyDeckError('markdown'))).toBe(
      'markdown_likely_lossy'
    );
  });

  it('maps PythonExitError to python_crash', () => {
    const err = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: 'traceback',
      jobId: 'job-py',
    });
    expect(jobFailureReasonCode(err)).toBe('python_crash');
  });

  it('maps an unauthorized Notion error to notion_token_expired', () => {
    expect(jobFailureReasonCode(makeUnauthorizedError())).toBe(
      'notion_token_expired'
    );
  });

  it('maps a COLUMNS_AMBIGUOUS error to columns_ambiguous', () => {
    const err = new Error('ambiguous') as Error & {
      code?: string;
      columns?: string[];
    };
    err.code = 'NOTION_DATABASE_COLUMNS_AMBIGUOUS';
    err.columns = ['Term', 'Definition'];
    expect(jobFailureReasonCode(err)).toBe('columns_ambiguous');
  });

  it.each([
    ['PARSER_CRASH', 'parser_crash'],
    ['WORKER_TIMEOUT', 'worker_timeout'],
    ['APKG_TOO_LARGE', 'apkg_too_large'],
    ['ZIP_INVALID', 'zip_invalid'],
  ] as const)('maps %s code to %s', (code, expected) => {
    expect(jobFailureReasonCode(withCode(code))).toBe(expected);
  });

  it('maps a Notion rate-limited error to notion_rate_limited', () => {
    expect(
      jobFailureReasonCode(makeAPIResponseError(APIErrorCode.RateLimited, 429))
    ).toBe('notion_rate_limited');
  });

  it('maps a Notion object-not-found error to notion_not_found', () => {
    expect(
      jobFailureReasonCode(
        makeAPIResponseError(APIErrorCode.ObjectNotFound, 404)
      )
    ).toBe('notion_not_found');
  });

  it('maps a database-not-page validation_error to notion_database_not_page', () => {
    expect(
      jobFailureReasonCode({
        code: 'validation_error',
        message: 'x is a database, not a page',
      })
    ).toBe('notion_database_not_page');
  });

  it('maps a pdfinfo_password error to pdf_password', () => {
    expect(jobFailureReasonCode(new Error('pdfinfo_password: encrypted'))).toBe(
      'pdf_password'
    );
  });

  it('maps a pdfinfo_failed error to pdf_unreadable', () => {
    expect(jobFailureReasonCode(new Error('pdfinfo_failed: corrupt'))).toBe(
      'pdf_unreadable'
    );
  });

  it('maps an unclassified error to unknown', () => {
    expect(jobFailureReasonCode(new Error('mystery'))).toBe('unknown');
    expect(jobFailureReasonCode('string error')).toBe('unknown');
    expect(jobFailureReasonCode(undefined)).toBe('unknown');
  });
});

describe('jobFailureReasonFromError on worker-flattened errors', () => {
  // The upload worker serialises errors to { message, name } and
  // GeneratePackagesUseCase rebuilds a plain Error, so every instanceof and
  // code check below sees a bare Error. These assert the reason still resolves
  // from the name that survived the boundary.
  function flatten(name: string, message: string): Error {
    const e = new Error(message);
    e.name = name;
    return e;
  }

  it('keeps the large-section message when the class was flattened', () => {
    expect(
      jobFailureReasonFromError(
        flatten('ClaudeLargeSectionError', LARGE_SECTION_USER_MESSAGE)
      )
    ).toBe(LARGE_SECTION_USER_MESSAGE);
  });

  it('keeps the python exit message when the class was flattened', () => {
    expect(
      jobFailureReasonFromError(flatten('PythonExitError', 'genanki blew up'))
    ).toBe('genanki blew up');
  });

  it('keeps the truncation message when the class was flattened', () => {
    expect(
      jobFailureReasonFromError(
        flatten('FileConversionError', CONVERSION_TRUNCATED_MESSAGE)
      )
    ).toBe(CONVERSION_TRUNCATED_MESSAGE);
  });

  it('does not leak an arbitrary FileConversionError message', () => {
    const reason = jobFailureReasonFromError(
      flatten(
        'FileConversionError',
        'Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests'
      ),
      'job-1'
    );
    expect(reason).not.toMatch(/anthropic-sdk-typescript/);
    expect(reason).toMatch(/Something went wrong on our end/);
  });

  it('does not leak a raw library error message', () => {
    const reason = jobFailureReasonFromError(
      new Error('ECONNRESET at TLSSocket._onTimeout (node:net:1234)'),
      'job-2'
    );
    expect(reason).not.toMatch(/TLSSocket/);
    expect(reason).toMatch(/Job ID job-2/);
  });
});
