import { inspect } from 'node:util';
import {
  buildPythonExitError,
  PythonExitError,
  pythonExitMessage,
  toUploadErrorCode,
} from './buildPythonExitError';

describe('buildPythonExitError', () => {
  it('classifies invalid HTML tag warnings as invalid-markup and tells the user to simplify the offending block', () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr:
        'UserWarning: Field contained the following invalid HTML tags and was cleaned. Please check the field for errors.\n  warnings.warn(',
      jobId: 'job-123',
    });
    expect(error).toBeInstanceOf(PythonExitError);
    expect(error.kind).toBe('invalid-markup');
    expect(error.message).toBe(
      "Something on this page — usually a pasted embed or copied-in web content — has formatting we can't read. Open the page in Notion, remove or simplify that block, and convert again."
    );
  });

  it("classifies Unsupported 'data_source'! as unsupported-data-source", () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: "RuntimeError: Unsupported 'data_source'!",
      jobId: 'job-123',
    });
    expect(error.kind).toBe('unsupported-data-source');
    expect(error.message).toBe(
      "This Notion database uses a view we don't support yet. Convert the parent page, or switch the database to a different view and try again."
    );
  });

  it('also matches the double-quoted variant of Unsupported "data_source"', () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: 'RuntimeError: Unsupported "data_source"!',
      jobId: 'job-123',
    });
    expect(error.kind).toBe('unsupported-data-source');
  });

  it('classifies MemoryError / Killed / exit code 137 as too-large', () => {
    const memoryErrorCase = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: 'MemoryError',
      jobId: 'job-1',
    });
    expect(memoryErrorCase.kind).toBe('too-large');
    expect(memoryErrorCase.message).toBe(
      'This page is too large for us to convert in one go. Split it into smaller pages — or convert it section by section — and try again.'
    );

    const killedLineCase = buildPythonExitError({
      code: null,
      stdout: '',
      stderr: 'some prefix\nKilled\n',
      jobId: 'job-2',
    });
    expect(killedLineCase.kind).toBe('too-large');

    const exit137Case = buildPythonExitError({
      code: 137,
      stdout: '',
      stderr: 'no helpful message',
      jobId: 'job-3',
    });
    expect(exit137Case.kind).toBe('too-large');
  });

  it('falls back to unknown kind with job ID and support email when output is empty', () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: '   \n',
      jobId: 'job-abc',
    });
    expect(error.kind).toBe('unknown');
    expect(error.message).toBe(
      "Something went wrong on our end converting this page. Email support@2anki.net with job ID job-abc and we'll take a look."
    );
  });

  it('falls back to unknown kind when stderr does not match any classifier', () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: 'progress output',
      stderr: 'Traceback (most recent call last):\n  ValueError: weird thing',
      jobId: 'job-xyz',
    });
    expect(error.kind).toBe('unknown');
    expect(error.message).toContain('support@2anki.net');
    expect(error.message).toContain('job-xyz');
  });

  it('never includes the words "Python", "script", or "exited" in the user-facing message', () => {
    const samples = [
      buildPythonExitError({
        code: 1,
        stdout: '',
        stderr: 'UserWarning: Field contained the following invalid HTML tags',
        jobId: 'j1',
      }),
      buildPythonExitError({
        code: 1,
        stdout: '',
        stderr: "Unsupported 'data_source'!",
        jobId: 'j2',
      }),
      buildPythonExitError({
        code: 137,
        stdout: '',
        stderr: '',
        jobId: 'j3',
      }),
      buildPythonExitError({
        code: 1,
        stdout: '',
        stderr: '',
        jobId: 'j4',
      }),
      buildPythonExitError({
        code: 1,
        stdout: '',
        stderr: 'random traceback',
        jobId: 'j5',
      }),
    ];
    const forbidden = /python|script|exited/i;
    for (const sample of samples) {
      expect(sample.message).not.toMatch(forbidden);
    }
  });

  it('retains the raw output on the error for server-side logging', () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: 'progress',
      stderr: "Unsupported 'data_source'!",
      jobId: 'job-keep-raw',
    });
    expect(error.rawOutput).toBe("Unsupported 'data_source'!");
    expect(error.code).toBe(1);
  });

  it('classifies FileNotFoundError with rename signature as bad-title', () => {
    const error = buildPythonExitError({
      code: 1,
      stdout: '',
      stderr: `Traceback (most recent call last):
  File "/app/create_deck.py", line 123, in <module>
    os.replace(tmp_path, final_path)
FileNotFoundError: [Errno 2] No such file or directory: '/tmp/deck.apkg' -> '/output/Biology / Chapter 1.apkg'`,
      jobId: 'job-slash-title',
    });
    expect(error.kind).toBe('bad-title');
    expect(error.message).toBe(
      'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.'
    );
  });
});

describe('toUploadErrorCode', () => {
  it('maps invalid-markup to invalid_markup', () => {
    expect(toUploadErrorCode('invalid-markup')).toBe('invalid_markup');
  });

  it('maps unsupported-data-source to malformed_notion', () => {
    expect(toUploadErrorCode('unsupported-data-source')).toBe(
      'malformed_notion'
    );
  });

  it('maps too-large to too_large', () => {
    expect(toUploadErrorCode('too-large')).toBe('too_large');
  });

  it('maps unknown to unknown', () => {
    expect(toUploadErrorCode('unknown')).toBe('unknown');
  });
});

describe('PythonExitError output in logs', () => {
  const crash = () =>
    buildPythonExitError({
      code: 1,
      stdout: '',
      stderr:
        "Traceback (most recent call last):\nOSError: cannot open '/srv/ws/1/Week 3 lab notes.apkg'",
    });

  it('keeps the raw output readable for classification and redaction', () => {
    expect(crash().rawOutput).toContain('Week 3 lab notes.apkg');
  });

  it('prints only the redacted output when the error is logged', () => {
    const printed = inspect(crash());

    expect(printed).toContain('OSError: cannot open [file]');
    expect(printed).not.toContain('Week 3 lab notes');
  });

  it('prints only the redacted output when logged inside another object', () => {
    const printed = inspect({ jobId: 'job-1', err: crash() });

    expect(printed).toContain('OSError: cannot open [file]');
    expect(printed).not.toContain('Week 3 lab notes');
  });

  it('leaves the raw output out of JSON', () => {
    expect(JSON.stringify(crash())).not.toContain('Week 3 lab notes');
  });
});

describe('pythonExitMessage reference sentence', () => {
  it.each([undefined, ''])(
    'leaves the job reference out when there is no job ID (%s)',
    (jobId) => {
      expect(pythonExitMessage('unknown', jobId)).toBe(
        "Something went wrong on our end converting this page. Email support@2anki.net and we'll take a look."
      );
    }
  );

  it('names the job when there is one', () => {
    expect(pythonExitMessage('unknown', 'job-42')).toContain('job ID job-42');
  });
});
