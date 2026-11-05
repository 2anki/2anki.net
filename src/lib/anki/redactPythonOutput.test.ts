import {
  scrubPythonRawOutput,
  scrubPythonRawOutputTail,
} from './redactPythonOutput';

describe('scrubPythonRawOutput', () => {
  it('keeps python file basenames from traceback paths', () => {
    const raw =
      'Traceback (most recent call last):\n  File "/app/create_deck/create_deck.py", line 12, in <module>';
    expect(scrubPythonRawOutput(raw)).toBe(
      'Traceback (most recent call last):\n  File "create_deck.py", line 12, in <module>'
    );
  });

  it('redacts non-python absolute paths', () => {
    const raw = 'FileNotFoundError: /workspace/123/uploads/secret-notes.html';
    expect(scrubPythonRawOutput(raw)).toBe('FileNotFoundError: [path]');
  });

  it('redacts quoted filenames containing user-named content', () => {
    const raw =
      "OSError: cannot open 'My Biology Deck Week 4.html' for reading";
    expect(scrubPythonRawOutput(raw)).toBe(
      'OSError: cannot open [file] for reading'
    );
  });

  it.each([
    [
      'an unquoted path with spaces in the file name',
      'Skipping media outside the working directory: /srv/ws/abc/Week 3 lab scan.png',
      'Skipping media outside the working directory: [path]',
    ],
    [
      'a quoted file name with an extension off the old list',
      "Missing media: {'Lecture 5 anatomy.svg'}",
      'Missing media: {[file]}',
    ],
    [
      'a double-quoted path with an apostrophe in it',
      'OSError: cannot open "/srv/ws/x/Sam\'s biology notes.apkg"',
      'OSError: cannot open [file]',
    ],
    [
      'a multi-word quoted value in an exception message',
      "ValueError: no back for 'Who wrote the first cell theory'",
      'ValueError: no back for [text]',
    ],
    [
      'a multi-word value after a contraction',
      "ValueError: Couldn't parse 'Sam Smith biology'",
      "ValueError: Couldn't parse [text]",
    ],
    [
      'a multi-word value in a list after a one-word one',
      "ValueError: bad fields ['Front', 'Who wrote the cell theory']",
      "ValueError: bad fields ['Front', [text]]",
    ],
    [
      'the multi-word values of a dict',
      "KeyError: {'Front': 'Who wrote it', 'Back': 'Schwann'}",
      "KeyError: {'Front': [text], 'Back': 'Schwann'}",
    ],
    [
      'a path whose file name has non-ASCII letters',
      'Skipping media outside the working directory: /srv/ws/abc/Übung 3 Anatomie.png',
      'Skipping media outside the working directory: [path]',
    ],
    [
      'a path whose file name has a version number before its extension',
      'Skipping media outside the working directory: /srv/ws/abc/Week 3 v1.2 final scan.png',
      'Skipping media outside the working directory: [path]',
    ],
    [
      'a user file name ending in .py',
      'Skipping media outside the working directory: /srv/ws/abc/My study plan.py',
      'Skipping media outside the working directory: [path]',
    ],
    [
      'a bytes literal holding user text',
      "UnicodeDecodeError: cannot decode b'Sam Smith notes'",
      'UnicodeDecodeError: cannot decode [text]',
    ],
    [
      'a unicode-prefixed literal holding user text',
      "ValueError: no back for u'Who wrote it'",
      'ValueError: no back for [text]',
    ],
    [
      'a path whose file name has a colon in it',
      'Skipping media outside the working directory: /srv/ws/abc/Week 3: Optics.png',
      'Skipping media outside the working directory: [path]',
    ],
    [
      'a multi-word value after an empty one in a list',
      "ValueError: no back for ['', 'Übung und Anatomie']",
      "ValueError: no back for ['', [text]]",
    ],
    [
      'a multi-word value after a non-ASCII one-word value',
      "KeyError: ['Café', 'Übung Anatomie']",
      "KeyError: ['Café', [text]]",
    ],
    [
      'a multi-word value after one ending in punctuation',
      "KeyError: ['Front?', '(a) the cell theory']",
      "KeyError: ['Front?', [text]]",
    ],
    [
      'a long quoted file name with no spaces',
      `OSError: cannot open '${'uke_3_Biologi_'.repeat(20)}.apkg'`,
      'OSError: cannot open [file]',
    ],
    [
      'an escaped repr holding both quote kinds',
      "ValueError: no back for 'Sam\\'s \"big\" day'",
      'ValueError: no back for [text]',
    ],
    [
      'an unquoted path with an apostrophe in the file name',
      "Skipping media outside the working directory: /srv/ws/abc/Sam's biology notes.png",
      'Skipping media outside the working directory: [path]',
    ],
  ])('redacts %s', (_label, raw, expected) => {
    expect(scrubPythonRawOutput(raw)).toBe(expected);
  });

  it('keeps the exception line of output far longer than the redaction window', () => {
    const raw =
      "UserWarning: Field contained the following invalid HTML tags: 'x y'\n".repeat(
        5000
      ) + "KeyError: 'Front'";

    expect(scrubPythonRawOutputTail(raw).endsWith("KeyError: 'Front'")).toBe(
      true
    );
  });

  it('keeps none of a single line longer than the redaction window', () => {
    const raw = "ValueError: 'Sam Smith " + 'z'.repeat(25_000) + "'";

    expect(scrubPythonRawOutputTail(raw)).toBe('[truncated]');
    expect(scrubPythonRawOutput(raw)).toBe('[truncated]');
  });

  it('keeps one-word field names in a list', () => {
    expect(
      scrubPythonRawOutput(
        "ValueError: Note fields ['Front', 'Back'] do not match"
      )
    ).toBe("ValueError: Note fields ['Front', 'Back'] do not match");
  });

  it('keeps the frame of a warning printed by the deck writer', () => {
    expect(
      scrubPythonRawOutput(
        '/app/create_deck/helpers/note.py:159: UserWarning: Field contained the following invalid HTML tags'
      )
    ).toBe(
      'note.py:159: UserWarning: Field contained the following invalid HTML tags'
    );
  });

  it('drops a line the window cuts into', () => {
    const raw = "'Sam Smith " + 'z'.repeat(25_000) + "'\nKeyError: 'Front'";

    expect(scrubPythonRawOutputTail(raw)).toBe("KeyError: 'Front'");
  });

  it('keeps a one-word quoted value, which names the failing field', () => {
    expect(scrubPythonRawOutput("KeyError: 'Front'")).toBe("KeyError: 'Front'");
  });

  it('redacts email addresses', () => {
    const raw = 'ValueError: bad value for student@example.com in field';
    expect(scrubPythonRawOutput(raw)).toBe(
      'ValueError: bad value for [email] in field'
    );
  });

  it('redacts long token-like strings', () => {
    const raw = `KeyError: secret_ntn_${'a'.repeat(40)}`;
    expect(scrubPythonRawOutput(raw)).toBe('KeyError: [token]');
  });

  it('truncates output to 500 characters', () => {
    const raw = 'KeyError: nested lookup failed\n'.repeat(100);
    expect(scrubPythonRawOutput(raw)).toHaveLength(500);
  });

  it('keeps the start of long output, where the traceback begins', () => {
    const raw = 'Traceback (most recent call last):\n' + 'x'.repeat(600);

    expect(
      scrubPythonRawOutput(raw).startsWith('Traceback (most recent call last):')
    ).toBe(true);
  });
});

describe('scrubPythonRawOutputTail', () => {
  it('keeps the last 500 characters, where the exception line is', () => {
    const raw =
      '  File "/app/create_deck/create_deck.py", line 12, in <module>\n'.repeat(
        20
      ) + 'KeyError: missing note field';

    const tail = scrubPythonRawOutputTail(raw);

    expect(tail).toHaveLength(500);
    expect(tail.endsWith('KeyError: missing note field')).toBe(true);
  });

  it('redacts a filename before keeping the tail', () => {
    const raw =
      "FileNotFoundError: [Errno 2] No such file: 'Week 3 notes.apkg'";

    expect(scrubPythonRawOutputTail(raw)).toBe(
      'FileNotFoundError: [Errno 2] No such file: [file]'
    );
  });
});

describe('redacting already-redacted output', () => {
  it.each([
    "OSError: cannot open '/srv/ws/1/Week 3 lab notes.apkg'",
    "KeyError: ['', 'Übung und Anatomie']",
    '/app/create_deck/helpers/note.py:159: UserWarning: Field contained invalid HTML',
    "ValueError: Couldn't parse 'Sam Smith biology'",
  ])('changes nothing the second time for %s', (raw) => {
    const once = scrubPythonRawOutputTail(raw);

    expect(scrubPythonRawOutput(once)).toBe(once);
  });
});
