#!/usr/bin/env bash
# Runs one SQL file against production Postgres, read-only. Run it from your
# machine; it opens one ssh call and sends the SQL over stdin:
#   scripts/prod-sql.sh query.sql
# The real guard is the read-only session. PGOPTIONS opens every transaction
# with default_transaction_read_only=on plus a statement and a lock timeout, and
# the same three settings are sent ahead of the file as SET statements, so they
# hold even if the connection string carries its own options. Postgres then
# refuses any write inside the session.
# The pre-flight below is defence in depth. default_transaction_read_only is an
# ordinary setting that SQL in the same session could turn off, so the
# pre-flight refuses statements that write, change a setting, run SQL held in a
# string, or are psql meta-commands that reach the shell or the file system. It
# matches words, not parsed SQL: it can refuse a harmless query (rephrase it),
# and it is not a sandbox against SQL written to slip past it; a read-only
# database role would be.
# The connection string is read on the box from the app's env file with grep,
# never sourced and never printed. Results are for the conversation or the
# private board only, never the repo, a PR or a memory file.
# Tests: python3 scripts/prod-sql.test.py (a fake ssh and psql, no network).
set -euo pipefail

PROD_HOST="alemayhu@2anki.net"
PROD_ENV_FILE_IN_HOME="src/github.com/2anki/2anki.net/.env"
MAX_SQL_BYTES=65536

SESSION_SETTINGS="SET default_transaction_read_only = on;
SET statement_timeout = '120s';
SET lock_timeout = '5s';"

# shellcheck disable=SC2016
REMOTE_SCRIPT='set -eu; env_file="$HOME/$1"; if [ ! -r "$env_file" ]; then echo "the app env file is not readable on the box" >&2; exit 6; fi; url=$(grep -E "^DATABASE_URL=" "$env_file" | head -n 1 | cut -d= -f2- | tr -d "\"\047\r"); if [ -z "$url" ]; then echo "DATABASE_URL is not set in the app env file" >&2; exit 6; fi; PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000" exec psql "$url" -X -q -v ON_ERROR_STOP=1 -f -'

preflight() {
  perl - "$1" <<'PERL'
use strict;
use warnings;

my $path = shift @ARGV;
open my $fh, '<', $path or die "cannot read the SQL file\n";
my $sql = do { local $/; <$fh> };
close $fh;

my @rules = (
  ['a NUL byte', qr/\0/],
  ['a backtick, which psql runs as a shell command in a meta-command', qr/`/],
  ['a psql meta-command other than \x \a \t \pset \echo \qecho \timing', qr/\\(?!(?:x|a|t|pset|echo|qecho|timing)(?![a-z]))[a-z!?]/i],
  ['a statement that writes data', qr/\b(?:insert|update|delete|truncate|merge|copy|into|upsert)\b/i],
  ['a statement that changes the schema or permissions', qr/\b(?:alter|drop|create|grant|revoke|reassign|cluster|reindex|vacuum|refresh|checkpoint|load|discard)\b|\bcomment\s+on\b|\bsecurity\s+label\b|\bimport\s+foreign\b|\block\s+table\b|(?:^|;)\s*lock\b/im],
  ['analyze outside explain analyze', qr/(?<!explain )(?<!\()\banaly[sz]e\b/i],
  ['a statement that changes a setting', qr/\b(?:set|reset|set_config)\b|\bread\s+write\b/i],
  ['SQL run from a string', qr/\b(?:execute|prepare|deallocate|call)\b|\bdo\s*(?:\$|'|language\b)|\b(?:query|cursor)_to_xml\w*|\bdblink\w*/i],
  ['a server function with side effects', qr/\b(?:pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_promote|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_sleep\w*|pg_advisory\w*|nextval|setval|lo_\w+)\b/i],
  ['listen or notify', qr/\b(?:listen|notify|unlisten)\b/i],
);

for my $rule (@rules) {
  my ($label, $pattern) = @$rule;
  if ($sql =~ $pattern) {
    my $line = 1 + (substr($sql, 0, $-[0]) =~ tr/\n//);
    print "refused: the SQL file has $label on line $line. The session is read-only anyway; this check refuses anything that writes or changes settings. Rephrase the query.\n";
    exit 1;
  }
}
PERL
}

if [ "$#" -ne 1 ]; then
  echo "usage: prod-sql.sh <file.sql>" >&2
  exit 2
fi
sql_file="$1"
if [ ! -f "$sql_file" ]; then
  echo "no such SQL file: $sql_file" >&2
  exit 2
fi
size=$(wc -c < "$sql_file" | tr -d ' ')
if [ "$size" -eq 0 ]; then
  echo "the SQL file is empty" >&2
  exit 2
fi
if [ "$size" -gt "$MAX_SQL_BYTES" ]; then
  echo "the SQL file is ${size} bytes; the limit is ${MAX_SQL_BYTES}" >&2
  exit 2
fi
if ! verdict=$(preflight "$sql_file"); then
  echo "$verdict" >&2
  exit 5
fi

remote_command=$(printf '%q ' bash -c "$REMOTE_SCRIPT" prod-sql "$PROD_ENV_FILE_IN_HOME")
{ printf '%s\n' "$SESSION_SETTINGS"; cat -- "$sql_file"; } \
  | ssh -o ConnectTimeout=10 -o BatchMode=yes "$PROD_HOST" "$remote_command"
