#!/usr/bin/env bash
# Runs one SQL file against production Postgres. Run it from your machine; it
# opens one ssh call and sends the SQL over stdin:
#   scripts/prod-sql.sh query.sql
#
# It is safe only for SQL that passes the pre-flight below. The pre-flight is
# an allowlist. It accepts a file only when every statement starts with
# select, with, explain (without analyze), show or table, and it refuses:
# comments, dollar quotes, E'' and U& strings or identifiers, any backslash
# (so no psql meta-command), non-ASCII outside single-quoted strings, control
# bytes, a byte order mark, double-quoted identifiers followed by "(", the
# words into, insert, update, delete, merge, copy, analyze, set and reset
# anywhere, for update and for share, credential catalogs, calls to a deny list
# of functions that change state or reach outside the database, and calls to
# any pg_ function outside a short list of size and catalog readers. Because
# every statement must start with an allowed word, transaction and session
# statements (begin, start, commit, rollback, end, abort, set, reset) are
# refused too.
# What it cannot guarantee: it reads words, not a parsed plan. A function it
# does not know about, including one from an extension, can still have side
# effects, and the app's database role can do far more than read. The durable
# fix is a dedicated role with SELECT grants only, not a superuser and not in
# the signal-backend role. Creating that role is an owner step tracked
# privately. Once it exists, put its connection string in the app's env file as
# READONLY_DATABASE_URL and this script connects as it; until then it falls
# back to DATABASE_URL.
#
# The session adds belt and braces on top: the file runs inside one
# BEGIN TRANSACTION READ ONLY ... ROLLBACK that the file cannot end early (the
# pre-flight refuses every transaction statement), with
# default_transaction_read_only, a statement timeout, a short lock timeout and
# a 300-second wall-clock cap on the whole run. On the box the connection
# string is parsed into PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE, so
# it never sits in the process list, and none of them is printed.
# Results are for the conversation or the private board only, never the repo,
# a PR or a memory file.
# Tests: python3 scripts/prod-sql.test.py (a fake ssh, timeout and psql, no network).
set -euo pipefail

PROD_HOST="alemayhu@2anki.net"
PROD_ENV_FILE_IN_HOME="src/github.com/2anki/2anki.net/.env"
MAX_SQL_BYTES=65536

SESSION_PREAMBLE="SET statement_timeout = '120s';
SET lock_timeout = '5s';
SET idle_in_transaction_session_timeout = '60s';
SET default_transaction_read_only = on;
BEGIN TRANSACTION READ ONLY;"

SESSION_EPILOGUE=";
ROLLBACK;"

preflight() {
  perl - "$1" <<'PERL'
use strict;
use warnings;

my $path = shift @ARGV;
open my $fh, '<:raw', $path or die "cannot read the SQL file\n";
my $sql = do { local $/; <$fh> };
close $fh;

my $allowed_starts = qr/^(?:select|with|explain|show|table)$/;
my $denied_words = qr/\b(?:into|insert|update|delete|merge|truncate|copy|analy[sz]e|execute|lock|set|reset|pg_authid|pg_shadow|pg_user_mappings?)\b/i;
my $denied_calls = qr/^(?:set_config|nextval|setval|currval|lastval|copy|dblink\w*|query_to_xml\w*|cursor_to_xml\w*|ts_stat|ts_rewrite|lo_\w+|txid_current\w*|http\w*)$/i;
my $safe_pg_calls = qr/^pg_(?:size_pretty|total_relation_size|relation_size|table_size|indexes_size|database_size|column_size|typeof|get_userbyid|get_indexdef|get_constraintdef|get_viewdef|get_expr|is_in_recovery|postmaster_start_time|backend_pid|size_bytes)$/i;
my $denied_schemas = qr/^(?:cron|net|dblink|extensions)$/i;

sub refuse {
  my ($reason, $offset) = @_;
  my $line = 1 + (substr($sql, 0, $offset) =~ tr/\n//);
  print "refused: $reason on line $line. The pre-flight accepts only plain select, with, explain, show and table statements.\n";
  exit 1;
}

refuse('a byte order mark', 0) if $sql =~ /^\xEF\xBB\xBF/;
refuse('a NUL or control byte', $-[0]) if $sql =~ /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
refuse('a backslash', $-[0]) if $sql =~ /\\/;
refuse('a comment', $-[0]) if $sql =~ /--|\/\*/;
refuse('a dollar sign', $-[0]) if $sql =~ /\$/;
refuse('a backtick', $-[0]) if $sql =~ /`/;

my @statements;
my $code = '';
my $start = 0;
my $i = 0;
my $n = length $sql;
while ($i < $n) {
  my $c = substr($sql, $i, 1);
  if ($c eq "'") {
    refuse('an E or U& string prefix', $i) if $code =~ /(?:^|[^A-Za-z0-9_])[eE]\z/ || $code =~ /[uU]&\z/;
    my $j = $i + 1;
    while (1) {
      refuse('an unterminated string', $i) if $j >= $n;
      if (substr($sql, $j, 1) eq "'") {
        if ($j + 1 < $n && substr($sql, $j + 1, 1) eq "'") { $j += 2; next; }
        last;
      }
      $j++;
    }
    $code .= "''";
    $i = $j + 1;
  } elsif ($c eq '"') {
    refuse('a U& identifier prefix', $i) if $code =~ /[uU]&\z/;
    my $j = $i + 1;
    while (1) {
      refuse('an unterminated quoted identifier', $i) if $j >= $n;
      my $d = substr($sql, $j, 1);
      refuse('non-ASCII text in a quoted identifier', $j) if ord($d) > 127;
      if ($d eq '"') {
        if ($j + 1 < $n && substr($sql, $j + 1, 1) eq '"') { $j += 2; next; }
        last;
      }
      $j++;
    }
    my $rest = substr($sql, $j + 1);
    refuse('a quoted identifier used as a function name', $i) if $rest =~ /^\s*\(/;
    $code .= '"q"';
    $i = $j + 1;
  } elsif ($c eq ';') {
    push @statements, [$code, $start];
    $code = '';
    $i++;
    $start = $i;
  } else {
    refuse('non-ASCII text outside a quoted string', $i) if ord($c) > 127;
    refuse('a U& prefix', $i) if $c eq '&' && $code =~ /[uU]\z/;
    $code .= $c;
    $i++;
  }
}
push @statements, [$code, $start];

my $kept = 0;
for my $statement (@statements) {
  my ($text, $offset) = @$statement;
  next if $text =~ /^\s*\z/;
  $kept++;
  my ($lead) = $text =~ /^(\s*)/;
  $offset += length $lead;
  $text = substr($text, length $lead);
  my ($first) = $text =~ /^\s*([A-Za-z_]+)/;
  refuse('a statement that does not start with select, with, explain, show or table', $offset)
    unless defined $first && lc($first) =~ $allowed_starts;
  refuse('a denied word', $offset + $-[0]) if $text =~ $denied_words;
  refuse('a row lock', $offset + $-[0]) if $text =~ /\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b/i;
  while ($text =~ /(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\(/g) {
    my ($schema, $name) = ($1, $2);
    my $at = $offset + $-[0];
    refuse('a call to a denied function', $at) if $name =~ $denied_calls;
    refuse('a call to a server function outside the safe list', $at) if $name =~ /^pg_/i && $name !~ $safe_pg_calls;
    refuse('a call into a denied schema', $at) if defined $schema && $schema =~ $denied_schemas;
  }
}
refuse('no statements', 0) unless $kept;
PERL
}

read_remote_script() {
  tr '\n' ' ' <<'PERL'
use strict;
use warnings;
my $env_file = "$ENV{HOME}/$ARGV[0]";
my $fail = sub { print STDERR "$_[0]\n"; exit 6 };
open(my $fh, "<", $env_file) or $fail->("the app env file is not readable on the box");
my %found;
while (my $line = <$fh>) {
  $line =~ s/\r?\n\z//;
  next unless $line =~ /^(READONLY_DATABASE_URL|DATABASE_URL)=(.*)\z/;
  my ($key, $value) = ($1, $2);
  $value =~ s/^["']//;
  $value =~ s/["']\z//;
  $found{$key} = $value unless exists $found{$key};
}
close $fh;
my $url = (defined $found{READONLY_DATABASE_URL} && length $found{READONLY_DATABASE_URL}) ? $found{READONLY_DATABASE_URL} : $found{DATABASE_URL};
$fail->("DATABASE_URL is not set in the app env file") unless defined $url && length $url;
my ($user, $password, $host, $port, $database, $query) = $url =~ m{^postgres(?:ql)?://(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?]*)(?::(\d+))?(?:/([^?]*))?(?:\?(.*))?\z};
$fail->("the connection string is not a postgres URL") unless defined $host;
my $decode = sub { my $s = shift; $s =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge; return $s };
delete $ENV{$_} for grep { /^PG/ } keys %ENV;
$ENV{PGHOST} = $decode->($host) if length $host;
$ENV{PGPORT} = $port if defined $port;
$ENV{PGUSER} = $decode->($user) if defined $user && length $user;
$ENV{PGPASSWORD} = $decode->($password) if defined $password;
$ENV{PGDATABASE} = $decode->($database) if defined $database && length $database;
for my $pair (split /&/, defined $query ? $query : "") {
  my ($k, $v) = split /=/, $pair, 2;
  $ENV{PGSSLMODE} = $decode->($v) if defined $v && $k eq "sslmode";
}
$ENV{PGOPTIONS} = "-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000";
$ENV{PGAPPNAME} = "prod-sql";
exec("timeout", "-k", "10s", "300s", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-") or do { print STDERR "could not start psql\n"; exit 7 };
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
  echo "${verdict:-refused: the pre-flight could not read the file}" >&2
  exit 5
fi

remote_script=$(read_remote_script)
remote_command=$(printf '%q ' perl -e "$remote_script" "$PROD_ENV_FILE_IN_HOME")
{ printf '%s\n' "$SESSION_PREAMBLE"; cat -- "$sql_file"; printf '\n%s\n' "$SESSION_EPILOGUE"; } \
  | ssh -o ConnectTimeout=10 -o BatchMode=yes "$PROD_HOST" "$remote_command"
