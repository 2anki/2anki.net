#!/usr/bin/env bash
# Windowed pm2 log error read for prod. Runs on the box, fed over stdin, and
# reads only the pm2 log files and `pm2 list`:
#   git show origin/main:scripts/prod-errors.sh | ssh -o ConnectTimeout=10 alemayhu@2anki.net 'bash -s -- 2026-11-24T09:30Z'
# The argument is a UTC start, to the minute or the second, such as a deploy
# run's startedAt. Output is masked on the box before it leaves: email
# addresses, IP addresses, query strings, bearer tokens, credentials, long
# tokens, Stripe ids and upload file names never print. Tests point it at
# fixture logs with PROD_CHECK_LOG_DIR (python3 scripts/prod-errors.test.py).
# Everything runs inside main with stdin from /dev/null, so no command can eat
# the rest of the script off the ssh stdin and a cut-off transfer runs nothing.
# The filter block is kept identical to the one in prod-deploy-check.sh; the
# tests compare the two.

CRASH_PATTERN='uncaught|unhandled|EADDRINUSE|ERR_REQUIRE|heap out of memory|FATAL'

write_filter() {
  cat > "$1" <<'PERL'
use strict;
use warnings;

my $mode = shift @ARGV // '';
my $ext = qr/(?:pdf|html?|zip|apkg|colpkg|md|markdown|csv|tsv|txt|xlsx?|docx?|pptx?|odt|epub|png|jpe?g|gif|webp|heic|svg|enex|opml|anki2)/i;
my $stamp = qr/^(\d{4}-\d\d-\d\dT\d\d:\d\d)[\d:.]*(?:Z|[+-]\d\d:?\d\d)?:?[ \t]?/;
my $access = qr/"([A-Z]+) (\S+) HTTP\/[\d.]+" (\d{3}|-)/;
my $value = qr/(?:(["'])(?:(?!\g{-1}).)*\g{-1}|[^\s,;})\]]+)/;
my $whole_value = qr/(?:(["'])(?:(?!\g{-1}).)*\g{-1}|[^,}\n]+)/;

sub mask {
  local $_ = shift;
  s/\e\[[\d;?]*[A-Za-z]//g;
  s{://[^/\s@]+@[^/\s:]*}{://<cred>@<host>}g;
  s/\$2[aby]\$\d\d\$[.\/A-Za-z0-9]{53}/<hash>/g;
  s/\b(authorization)(["']?\s*[:=]\s*)(?:(["'])(?:(?!\3).)*\3|(?:basic|bearer|digest|negotiate)\s+[^\s"',;})\]]+|[^\s,;})\]]+)/$1$2<secret>/gi;
  s/\bbearer\s+[^\s"',;]+/Bearer <token>/gi;
  s/\beyJ[\w-]+\.[\w-]+\.[\w-]*/<jwt>/g;
  s/\b(\w*token|\w*_key|\w*secret|password\w*|passwd|cookie|set-cookie|x-api-key|api[_-]?key|connect\.sid|sid)(["']?\s*[:=]\s*)$value/$1$2<secret>/gi;
  s/[\w.%+-]+%40[\w-]+(?:\.[\w-]+)+/<email>/gi;
  s/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/<email>/g;
  s/\?[^\s"']*/?<query>/g;
  s{(/(?:magic|reset|verify|share)/)(?!confirm(?![^/\s?"']))[^/\s?"']+}{$1<tok>}gi;
  s/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/<id>/g;
  s/(?<![\w:.])(?:[0-9a-fA-F]{0,4}:){2,6}(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/<ip>/g;
  s/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/<ip>/g;
  s{(?<![\w:.])[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7}(?![\w:])}{ my $m = $&; ($m =~ /::/ || ($m =~ tr/://) >= 7) ? '<ip>' : $m }ge;
  s{\b(cus|sub|si|pi|ch|cs|in|ii|pm|py|re|txn|evt|prod|price|plink|seti|acct|card|src|tok|sk|rk|pk|whsec|promo|bpc)_((?:live_|test_)?[A-Za-z0-9]{8,})}{ my ($p, $t) = ($1, $2); ($t =~ /[0-9A-Z]/ || length($t) >= 14) ? "${p}_<id>" : "${p}_$t" }ge;
  s/\b[0-9a-fA-F]{16,}\b/<hex>/g;
  s{[A-Za-z0-9+_-]{24,}={0,2}}{ my $m = $&; ($m =~ /\d/ && $m =~ /[A-Za-z]/) ? '<blob>' : $m }ge;
  s/(["'`])[^"'`\n]*?\.$ext\1/$1<file>$1/g;
  s{[^\s"'`/\\=:,;()<>\[\]{}]+\.$ext\b}{<file>}g;
  s/\b(name|deck|deck_?name|title|subject|customer|customer_name|workspace|workspace_name|file_?name|original_?name|email)(["']?\s*[:=]\s*)$whole_value/$1$2<name>/gi;
  s/\b(name|file|first_?file|path|key)(["']?\s*[:=]\s*)$value/$1$2<name>/gi if /\[upload\]/i;
  return $_;
}

sub collapse {
  local $_ = shift;
  s/\d+/N/g;
  return $_;
}

sub route {
  my $path = shift;
  $path =~ s/\?.*//s;
  $path = mask($path);
  $path =~ s{/[^/]*%[^/]*}{/<enc>}g;
  $path =~ s{/\d+(?=/|$)}{/:n}g;
  $path =~ s{/(?=[^/]*\d)(?=[^/]*[A-Za-z])[A-Za-z0-9_-]{8,}(?=/|$)}{/<tok>}g;
  $path =~ s{/[A-Za-z0-9_-]{20,}(?=/|$)}{/<tok>}g;
  return $path;
}

sub route_class {
  my $path = shift;
  $path =~ s/\?.*//s;
  return 'upload' if $path =~ m{^/api/upload/file(?:/|$)};
  return 'claim' if $path =~ m{^/api/upload/claim(?:/|$)};
  return 'checkout' if $path =~ m{checkout};
  return 'webhook' if $path =~ m{webhook};
  return 'sign-in' if $path =~ m{^/api/users/(?:login|magic)};
  return undef;
}

my %by_class;
while (my $line = <STDIN>) {
  chomp $line;
  if ($mode eq 'mask') {
    print mask($line), "\n";
  } elsif ($mode eq 'message') {
    (my $rest = $line) =~ s/$stamp//;
    print collapse(mask($rest)), "\n";
  } elsif ($mode eq 'stamped' || $mode eq 'stamped-raw') {
    my $rest = $line;
    my $minute = $rest =~ s/$stamp// ? $1 : '-';
    my $masked = mask($rest);
    $masked = collapse($masked) if $mode eq 'stamped';
    print "$minute $masked\n";
  } elsif ($mode eq 'routes-5xx') {
    my ($method, $path, $status) = $line =~ $access;
    print "$method ", route($path), " $status\n" if defined $status && $status =~ /^5/;
  } elsif ($mode eq 'status-mix') {
    my ($method, $path, $status) = $line =~ $access;
    next unless defined $status;
    print $status eq '-' ? "no response\n" : substr($status, 0, 1) . "xx\n";
  } elsif ($mode eq 'events') {
    my $masked = mask($line);
    print "$1\n" while $masked =~ /(?<![\w.])((?:webhook|pass|checkout|credits?)\.[a-z_]+(?:\.[a-z_]+)*)/g;
  } elsif ($mode eq 'route-status') {
    my ($method, $path, $status) = $line =~ $access;
    next unless defined $status;
    my $class = route_class($path);
    $by_class{$class}{$status}++ if defined $class;
  } else {
    die "unknown filter mode\n";
  }
}

if ($mode eq 'route-status') {
  for my $class (qw(upload claim checkout webhook sign-in)) {
    my $counts = $by_class{$class} || {};
    my @parts = map { "$_=$counts->{$_}" } sort keys %$counts;
    print "$class: ", (@parts ? join(' ', @parts) : 'none'), "\n";
  }
}
PERL
}

valid_start() {
  local pattern='^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|\+00:00)?$'
  [[ "$1" =~ $pattern ]]
}

window_start() {
  local start="${1%Z}"
  start="${start%+00:00}"
  printf '%s' "${start:0:19}"
}

read_window() {
  local start="$1"
  shift
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  cat -- "$@" \
    | awk -v s="$start" '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]/ && substr($0, 1, length(s)) >= s' \
    | sort
}

count_matching() {
  grep -ac "$@" || true
}

main() {
  set -euo pipefail
  export LC_ALL=C

  if [ "$#" -ne 1 ] || ! valid_start "$1"; then
    echo "usage: prod-errors.sh <UTC start such as 2026-11-24T09:30 or 2026-11-24T09:30:12Z>" >&2
    return 2
  fi
  if ! command -v perl > /dev/null 2>&1; then
    echo "perl is needed to mask the output and was not found" >&2
    return 5
  fi

  local since log_dir work filter out_lines error_lines
  since=$(window_start "$1")
  log_dir="${PROD_CHECK_LOG_DIR:-$HOME/.pm2/logs}"
  PROD_CHECK_WORK=$(mktemp -d)
  trap 'rm -rf "$PROD_CHECK_WORK"' EXIT
  work="$PROD_CHECK_WORK"
  filter="$work/filter.pl"
  write_filter "$filter"

  shopt -s nullglob
  out_files=("$log_dir"/server-*-out*.log)
  error_files=("$log_dir"/server-*-error*.log)
  shopt -u nullglob
  read_window "$since" ${out_files[@]+"${out_files[@]}"} > "$work/out"
  read_window "$since" ${error_files[@]+"${error_files[@]}"} > "$work/error"
  sort -m "$work/out" "$work/error" > "$work/all"

  out_lines=$(wc -l < "$work/out" | tr -d ' ')
  error_lines=$(wc -l < "$work/error" | tr -d ' ')
  echo "== window: since ${since} UTC until $(date -u +%FT%T) UTC, ${out_lines} out lines, ${error_lines} error lines"
  if [ $((out_lines + error_lines)) -eq 0 ]; then
    echo "no log lines in the window, so there is nothing to read" >&2
    return 3
  fi

  echo "== pm2 processes"
  if ! command -v pm2 > /dev/null 2>&1; then
    echo "pm2 not found"
  elif pm2 list > "$work/pm2" 2> /dev/null < /dev/null; then
    perl "$filter" mask < "$work/pm2" | { grep -aE 'server-|name' || true; }
  else
    echo "pm2 list failed"
  fi

  echo "== crashes: $(count_matching -iE "$CRASH_PATTERN" "$work/all")"
  { grep -aiE "$CRASH_PATTERN" "$work/all" || true; } | tail -n 8 | perl "$filter" stamped | cut -c1-260

  echo "== 5xx by route"
  perl "$filter" routes-5xx < "$work/all" | sort | uniq -c | sort -rn | awk 'NR <= 15'

  echo "== status mix"
  perl "$filter" status-mix < "$work/out" | sort | uniq -c

  echo "== error log, collapsed (top 30)"
  perl "$filter" message < "$work/error" | cut -c1-140 | sort | uniq -c | sort -rn | awk 'NR <= 30'

  echo "== checkout, pass, webhook and credit events"
  perl "$filter" events < "$work/all" | sort | uniq -c | sort -rn | awk 'NR <= 25'

  echo "== memory (last 3)"
  { grep -aF '[memory] rss' "$work/out" || true; } | tail -n 3 | perl "$filter" stamped-raw | cut -c1-220
}

main "$@" < /dev/null
