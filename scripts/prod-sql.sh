#!/usr/bin/env bash
# Runs one SQL file against production Postgres. Run it from your machine; it
# opens one ssh call and sends the SQL over stdin:
#   scripts/prod-sql.sh query.sql
#
# It connects as the dedicated read-only database role, whose connection string
# is in the box's app env file as READONLY_DATABASE_URL; if that variable is
# missing the script refuses before connecting. There is no fallback to the
# application's role. The role's own privileges are the guard ("Read-only
# database role" in .claude/docs/prod-ops.md describes it). Before psql starts
# it also refuses a READONLY_DATABASE_URL with no host or no user, or with the
# same user as DATABASE_URL (that line is read only to compare the user). Right
# after BEGIN, before the caller's SQL, the session checks its own role and
# ends the run with "the connected role is not read-only" unless the role is
# not a superuser, cannot create roles or databases, has no replication or
# bypassrls, is not a member of pg_write_all_data, pg_signal_backend,
# pg_execute_server_program, pg_read_server_files or pg_write_server_files,
# and neither owns nor can insert, update, delete or truncate any table outside
# the system schemas.
#
# The pre-flight below is a second layer, not a guarantee. The file is copied
# once; the pre-flight checks that copy and the same copy is sent.
#
# The pre-flight accepts a file only when every statement starts with select,
# with, explain, show, table or values, and every function it calls is on the
# list in ALLOWED_FUNCTIONS below (schema absent or pg_catalog). To call
# another function, add it to that list in a reviewed PR with a test. After a
# ")" or "]" a "." may only be followed by "*", so field access on a
# parenthesised value such as (row).column is refused; select the row with
# (t).* or name the column through a table alias. alias.column,
# schema.table, schema.table.column and alias.* are accepted. The name of every
# function call and the alias written after its closing parenthesis (with or
# without as) may likewise only be followed by ".*", and rows from is refused.
# A column alias list such as g(n) after a FROM item is not a call.
# It also refuses: comments, a backslash or a dollar sign outside a
# single-quoted string (so no psql meta-command and no dollar quote; inside a
# string they are plain characters because standard_conforming_strings is
# forced on), E'' and U& strings or identifiers (an e directly before a quote
# is refused unless it ends a longer name), a colon before a name or quote (so
# no psql variable), backticks, non-ASCII outside single-quoted strings,
# control bytes, a byte order mark, the words into, insert, update, delete,
# merge, truncate, copy, analyze, execute, lock, set and reset, row locks, and
# the role, credential, subscription, large object and statistics catalogs.
# explain takes only the bare form or the options format, costs, verbose and
# settings. Every check reads the lowercased contents of double-quoted
# identifiers as well as plain words, and a quoted identifier before "(" is a
# function call. Transaction and session statements are refused because no
# statement may start with them. psql display commands such as \echo are
# refused with every other backslash command, so write a section label as an
# ordinary statement: select '== signups' as section;
#
# What it cannot guarantee: it reads tokens, not a query plan, so it cannot see
# what a function does with its arguments. It does not stop a select of secret
# columns of app tables (password hashes, reset and sign-in tokens, payment
# provider ids); agents must not select them, and the role is where they are
# revoked.
#
# The session adds another layer: the file runs inside one
# BEGIN TRANSACTION READ ONLY ... ROLLBACK that the file cannot end early, with
# default_transaction_read_only, standard_conforming_strings on, UTF8 client
# encoding and a 300-second wall-clock cap on the whole run. The statement,
# lock and idle-in-transaction timeouts are set to the script's values only
# when the role's own value is unset or higher, so a stricter role setting
# wins; temp_file_limit is left to the role. On the box the connection
# string is parsed into PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE, so
# it never sits in the process list, and none of them is printed.
# Results are for the conversation or the private board only, never the repo,
# a PR or a memory file.
# Tests: python3 scripts/prod-sql.test.py (a fake ssh, timeout and psql, no network).
set -euo pipefail

PROD_HOST="alemayhu@2anki.net"
PROD_ENV_FILE_IN_HOME="src/github.com/2anki/2anki.net/.env"
MAX_SQL_BYTES=65536

ALLOWED_FUNCTIONS="
count sum avg min max bool_and bool_or array_agg string_agg jsonb_agg percentile_cont percentile_disc mode
coalesce nullif greatest least cast
now date_trunc date_part extract age make_interval to_char to_timestamp timezone
lower upper length left right substr substring position strpos split_part trim btrim ltrim rtrim replace
regexp_replace regexp_match concat concat_ws format md5
round floor ceil abs width_bucket
jsonb_array_length jsonb_object_keys jsonb_array_elements jsonb_array_elements_text jsonb_typeof
jsonb_extract_path_text to_jsonb
generate_series unnest row_number rank dense_rank lag lead first_value last_value ntile
pg_size_pretty pg_total_relation_size pg_relation_size pg_database_size current_database pg_has_role
version
"

session_preamble() {
  cat <<'SQL'
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET default_transaction_read_only = on;
\o /dev/null
SELECT set_config('statement_timeout', '120000', false) FROM pg_settings WHERE name = 'statement_timeout' AND (setting::bigint = 0 OR setting::bigint > 120000);
SELECT set_config('lock_timeout', '5000', false) FROM pg_settings WHERE name = 'lock_timeout' AND (setting::bigint = 0 OR setting::bigint > 5000);
SELECT set_config('idle_in_transaction_session_timeout', '60000', false) FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout' AND (setting::bigint = 0 OR setting::bigint > 60000);
\o
BEGIN TRANSACTION READ ONLY;
\o /dev/null
\set ON_ERROR_STOP 0
SELECT 1 / count(*) FROM (SELECT 1 / (CASE WHEN NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('pg_write_all_data','pg_signal_backend','pg_execute_server_program','pg_read_server_files','pg_write_server_files') AND pg_has_role(r.oid, g.oid, 'MEMBER')) AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p') AND (pg_has_role(r.oid, c.relowner, 'MEMBER') OR has_table_privilege(r.oid, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE'))) THEN 1 ELSE 0 END) AS role_is_read_only FROM pg_roles r WHERE r.rolname = session_user) AS role_check WHERE role_is_read_only = 1;
\set ON_ERROR_STOP 1
\o
\if :ERROR
\warn 'refused: the connected role is not read-only. See "Read-only database role" in .claude/docs/prod-ops.md.'
SELECT 'role check failed';
\endif
SQL
}

SESSION_EPILOGUE=";
ROLLBACK;"

preflight() {
  ALLOWED_FUNCTIONS="$ALLOWED_FUNCTIONS" perl - "$1" <<'PERL'
use strict;
use warnings;

my $path = shift @ARGV;
open my $fh, '<:raw', $path or die "cannot read the SQL file\n";
my $sql = do { local $/; <$fh> };
close $fh;

my %allowed_functions = map { $_ => 1 } split ' ', $ENV{ALLOWED_FUNCTIONS};
my %call_like_keywords = map { $_ => 1 } qw(
  in exists any all some over filter group values as on using and or not between like ilike is
  when then else case where from join lateral select distinct by having union intersect except
  limit offset array row rollup cube sets materialized
);
my %type_modifiers = map { $_ => 1 } qw(numeric decimal varchar char character varying bit varbit timestamp timestamptz time timetz interval);
my %allowed_starts = map { $_ => 1 } qw(select with explain show table values);
my %denied_words = map { $_ => 1 } qw(into insert update delete merge truncate copy analyze analyse execute lock set reset);
my %denied_relations = map { $_ => 1 } qw(
  pg_authid pg_shadow pg_user_mapping pg_user_mappings pg_largeobject pg_largeobject_metadata
  pg_statistic pg_statistic_ext_data pg_stats pg_stats_ext pg_stats_ext_exprs pg_hba_file_rules pg_file_settings
  pg_subscription
);
my %explain_options = map { $_ => 1 } qw(format costs verbose settings);
my %explain_formats = map { $_ => 1 } qw(text json yaml xml);
my %explain_switches = map { $_ => 1 } qw(on off true false 0 1);
my %explainable = map { $_ => 1 } qw(select with table);

sub refuse {
  my ($reason, $offset) = @_;
  my $line = 1 + (substr($sql, 0, $offset) =~ tr/\n//);
  print "refused: the SQL file has $reason on line $line. The pre-flight accepts only select, with, explain, show, table and values statements that call functions on its list.\n";
  exit 1;
}

refuse('a byte order mark', 0) if $sql =~ /^\xEF\xBB\xBF/;
refuse('a NUL or control byte', $-[0]) if $sql =~ /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
refuse('a comment', $-[0]) if $sql =~ /--|\/\*/;
refuse('a backtick', $-[0]) if $sql =~ /`/;

my @tokens;
my $i = 0;
my $n = length $sql;
while ($i < $n) {
  my $c = substr($sql, $i, 1);
  if ($c =~ /\s/) {
    $i++;
  } elsif ($c eq "'") {
    my $before = substr($sql, 0, $i);
    if ($before =~ /([A-Za-z0-9_]*)[eE]\z/) {
      my $run = $1;
      refuse('an E string', $i) if $run eq '' || $run =~ /^[0-9]/;
    }
    refuse('a U& string', $i) if $before =~ /[uU]&\z/;
    my $j = $i + 1;
    while (1) {
      refuse('an unterminated string', $i) if $j >= $n;
      if (substr($sql, $j, 1) eq "'") {
        if ($j + 1 < $n && substr($sql, $j + 1, 1) eq "'") { $j += 2; next; }
        last;
      }
      $j++;
    }
    push @tokens, { kind => 'string', text => '', at => $i };
    $i = $j + 1;
  } elsif ($c eq '"') {
    refuse('a U& identifier', $i) if substr($sql, 0, $i) =~ /[uU]&\z/;
    my $j = $i + 1;
    my $contents = '';
    while (1) {
      refuse('an unterminated quoted identifier', $i) if $j >= $n;
      my $d = substr($sql, $j, 1);
      refuse('non-ASCII text in a quoted identifier', $j) if ord($d) > 127;
      if ($d eq '"') {
        if ($j + 1 < $n && substr($sql, $j + 1, 1) eq '"') { $contents .= '"'; $j += 2; next; }
        last;
      }
      $contents .= $d;
      $j++;
    }
    push @tokens, { kind => 'quoted', text => lc $contents, at => $i };
    $i = $j + 1;
  } elsif ($c =~ /[A-Za-z_]/) {
    substr($sql, $i) =~ /^([A-Za-z_][A-Za-z0-9_]*)/;
    push @tokens, { kind => 'word', text => lc $1, at => $i };
    $i += length $1;
  } elsif ($c =~ /[0-9]/ || ($c eq '.' && substr($sql, $i + 1, 1) =~ /[0-9]/)) {
    substr($sql, $i) =~ /^([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+\.)/;
    push @tokens, { kind => 'number', text => $1, at => $i };
    $i += length $1;
  } elsif ($c eq ':') {
    my $next = $i + 1 < $n ? substr($sql, $i + 1, 1) : '';
    if ($next eq ':') {
      push @tokens, { kind => 'punct', text => '::', at => $i };
      $i += 2;
    } elsif ($next eq '' || $next =~ /[0-9\]\s]/) {
      push @tokens, { kind => 'punct', text => ':', at => $i };
      $i++;
    } else {
      refuse('a colon before a name or quote, which psql reads as a variable', $i);
    }
  } elsif (ord($c) > 127) {
    refuse('non-ASCII text outside a quoted string', $i);
  } elsif ($c eq '\\') {
    refuse('a backslash outside a string', $i);
  } elsif ($c eq '$') {
    refuse('a dollar sign outside a string', $i);
  } else {
    push @tokens, { kind => 'punct', text => $c, at => $i };
    $i++;
  }
}

my @statements = ([]);
for my $token (@tokens) {
  if ($token->{kind} eq 'punct' && $token->{text} eq ';') {
    push @statements, [];
  } else {
    push @{ $statements[-1] }, $token;
  }
}

sub is_name { my $t = shift; return defined $t && ($t->{kind} eq 'word' || $t->{kind} eq 'quoted') }
sub is_punct { my ($t, $p) = @_; return defined $t && $t->{kind} eq 'punct' && $t->{text} eq $p }
sub is_word { my ($t, $w) = @_; return defined $t && $t->{kind} eq 'word' && $t->{text} eq $w }

sub check_explain {
  my ($s) = @_;
  my $k = 1;
  if (is_punct($s->[$k], '(')) {
    $k++;
    while (1) {
      my $option = $s->[$k];
      refuse('an explain option list that does not close', $s->[0]{at}) unless defined $option;
      refuse("the explain option $option->{text}", $option->{at}) unless is_name($option) && $explain_options{ $option->{text} };
      $k++;
      my $value = $s->[$k];
      if (defined $value && !is_punct($value, ',') && !is_punct($value, ')')) {
        my $ok = $option->{text} eq 'format' ? $explain_formats{ $value->{text} } : $explain_switches{ $value->{text} };
        my $shown = $value->{kind} eq 'string' ? 'a quoted string' : $value->{text};
        refuse("the explain option value $shown", $value->{at}) unless $ok && $value->{kind} ne 'quoted' && $value->{kind} ne 'string';
        $k++;
      }
      if (is_punct($s->[$k], ',')) { $k++; next; }
      last if is_punct($s->[$k], ')');
      refuse('an explain option list that does not close', defined $s->[$k] ? $s->[$k]{at} : $option->{at});
    }
    $k++;
  }
  my $target = $s->[$k];
  refuse('explain followed by anything but select, with or table, or allowed options', defined $target ? $target->{at} : $s->[0]{at})
    unless defined $target && $target->{kind} eq 'word' && $explainable{ $target->{text} };
}

my $kept = 0;
for my $s (@statements) {
  next unless @$s;
  $kept++;
  my $first = $s->[0];
  refuse('a statement that does not start with select, with, explain, show, table or values', $first->{at})
    unless $first->{kind} eq 'word' && $allowed_starts{ $first->{text} };
  for my $k (0 .. $#$s) {
    my $t = $s->[$k];
    next unless is_name($t);
    refuse("the word $t->{text}", $t->{at}) if $denied_words{ $t->{text} };
    refuse("the catalog $t->{text}", $t->{at}) if $denied_relations{ $t->{text} };
    if ($t->{text} eq 'for' && $t->{kind} eq 'word') {
      my $next = $s->[$k + 1];
      refuse('a row lock', $t->{at}) if is_name($next) && $next->{text} =~ /^(?:share|key|no|update)$/;
    }
  }
  check_explain($s) if $first->{text} eq 'explain';
  my %call_aliases;
  for my $k (0 .. $#$s - 1) {
    next unless is_call($s, $k);
    my $t = $s->[$k];
    if ($k >= 1 && is_punct($s->[$k - 1], '.')) {
      my $schema = $s->[$k - 2];
      refuse("a call to $t->{text} through a schema other than pg_catalog", $t->{at})
        unless $k >= 2 && is_name($schema) && $schema->{text} eq 'pg_catalog' && !($k >= 3 && is_punct($s->[$k - 3], '.'));
    }
    refuse_call($t) unless $allowed_functions{ $t->{text} };
    $call_aliases{ $t->{text} } = 1;
    my $close = closing_paren($s, $k + 1);
    next unless defined $close;
    my $alias = $s->[$close + 1];
    $alias = $s->[$close + 2] if is_word($alias, 'as');
    $call_aliases{ $alias->{text} } = 1 if is_name($alias);
  }
  for my $k (0 .. $#$s - 1) {
    my $t = $s->[$k];
    refuse('rows from', $t->{at}) if is_word($t, 'rows') && is_word($s->[$k + 1], 'from');
    next unless is_punct($s->[$k + 1], '.');
    my $after_bracket = is_punct($t, ')') || is_punct($t, ']');
    my $after_call_alias = is_name($t) && $call_aliases{ $t->{text} };
    next unless $after_bracket || $after_call_alias;
    refuse('a name after a dot that follows a closing bracket or the alias of a function call (only .* may follow)', $s->[$k + 1]{at})
      unless is_punct($s->[$k + 2], '*');
  }
}

sub is_call {
  my ($s, $k) = @_;
  my $t = $s->[$k];
  return 0 unless is_name($t) && is_punct($s->[$k + 1], '(');
  return 0 if $k == 0 && $t->{kind} eq 'word' && $t->{text} eq 'explain';
  return 1 if $t->{kind} eq 'quoted';
  return 1 if $k >= 1 && is_punct($s->[$k - 1], '.');
  return 0 if $call_like_keywords{ $t->{text} } || $type_modifiers{ $t->{text} };
  return 0 if $k >= 1 && $s->[$k - 1]{kind} eq 'word' && $s->[$k - 1]{text} =~ /^(?:as|with|recursive)$/;
  return 0 if $k >= 1 && is_punct($s->[$k - 1], ')');
  return 1;
}

sub closing_paren {
  my ($s, $open) = @_;
  my $depth = 0;
  for my $k ($open .. $#$s) {
    $depth++ if is_punct($s->[$k], '(');
    $depth-- if is_punct($s->[$k], ')');
    return $k if $depth == 0;
  }
  return undef;
}

sub refuse_call {
  my ($t) = @_;
  my $line = 1 + (substr($sql, 0, $t->{at}) =~ tr/\n//);
  print "refused: the SQL file calls $t->{text} on line $line, which is not on the function list in scripts/prod-sql.sh. If it only reads, add it to ALLOWED_FUNCTIONS in a reviewed PR with a test.\n";
  exit 1;
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
my $url = $found{READONLY_DATABASE_URL};
$fail->("refused: READONLY_DATABASE_URL is not in the app env file on the box, so there is no read-only role to connect as. See \"Read-only database role\" in .claude/docs/prod-ops.md.") unless defined $url && length $url;
my $url_pattern = qr{^postgres(?:ql)?://(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?]*)(?::(\d+))?(?:/([^?]*))?(?:\?(.*))?\z};
my $decode = sub { my $s = shift; $s =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge; return $s };
my ($user, $password, $host, $port, $database, $query) = $url =~ $url_pattern;
$fail->("refused: READONLY_DATABASE_URL is not a postgres URL") unless defined $host;
$fail->("refused: READONLY_DATABASE_URL has no host or no user") unless length $host && defined $user && length $user;
my ($application_user) = defined $found{DATABASE_URL} ? $found{DATABASE_URL} =~ $url_pattern : ();
$fail->("refused: READONLY_DATABASE_URL uses the same database user as DATABASE_URL, so it is not a separate read-only role") if defined $application_user && lc($decode->($application_user)) eq lc($decode->($user));
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
$ENV{PGOPTIONS} = "-c default_transaction_read_only=on -c standard_conforming_strings=on";
$ENV{PGCLIENTENCODING} = "UTF8";
$ENV{PGAPPNAME} = "prod-sql";
exec("timeout", "-k", "10s", "300s", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-") or do { print STDERR "could not start psql\n"; exit 7 };
PERL
}

if [ "$#" -ne 1 ]; then
  echo "usage: prod-sql.sh <file.sql>" >&2
  exit 2
fi
if [ ! -f "$1" ]; then
  echo "no such SQL file: $1" >&2
  exit 2
fi
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
sql_copy="$work_dir/query.sql"
cp -- "$1" "$sql_copy"

size=$(wc -c < "$sql_copy" | tr -d ' ')
if [ "$size" -eq 0 ]; then
  echo "the SQL file is empty" >&2
  exit 2
fi
if [ "$size" -gt "$MAX_SQL_BYTES" ]; then
  echo "the SQL file is ${size} bytes; the limit is ${MAX_SQL_BYTES}" >&2
  exit 2
fi
if ! verdict=$(preflight "$sql_copy"); then
  echo "${verdict:-refused: the pre-flight could not read the file}" >&2
  exit 5
fi

remote_script=$(read_remote_script)
remote_command=$(printf '%q ' perl -e "$remote_script" "$PROD_ENV_FILE_IN_HOME")
{ session_preamble; cat -- "$sql_copy"; printf '\n%s\n' "$SESSION_EPILOGUE"; } \
  | ssh -o ConnectTimeout=10 -o BatchMode=yes "$PROD_HOST" "$remote_command"
