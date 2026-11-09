#!/bin/bash
# Encrypted Postgres backup to DigitalOcean Spaces, run nightly from cron.
#
# The box only holds the public key, so a stored dump cannot be read from the
# bucket or from this box later. The private key stays with the owner, outside
# this repo and this box.
#
# Keeps one dump per weekday, overwritten a week later, and one per month.
#
# Restore on a machine holding the private key:
#   aws s3 cp --endpoint-url "$SPACES_ENDPOINT" \
#     "s3://$BUCKET/backups/postgres/daily-Mon.dump.gpg" dump.gpg
#   gpg --output dump --decrypt dump.gpg
#   createdb 2anki_restored
#   pg_restore --no-owner --dbname 2anki_restored dump
#
# Needs: BACKUP_ALERT_EMAIL (in the environment or the .env), and the public
# key at BACKUP_PUBLIC_KEY. The app's bucket sweep leaves backups/ alone; see
# RESERVED_KEY_PREFIXES in isDeletableBucketKey.ts.
set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-$HOME/src/github.com/2anki/2anki.net/.env}"
PUBLIC_KEY="${BACKUP_PUBLIC_KEY:-$HOME/.config/2anki-backup/public.asc}"
WORK_ROOT="${BACKUP_WORK_ROOT:-$HOME/.cache/2anki-backup}"
ALERT_TO="${BACKUP_ALERT_EMAIL:-}"
# Cron's PATH is only /usr/bin:/bin; sendmail and the aws CLI live elsewhere.
export PATH="$PATH:$HOME/.local/bin:/usr/sbin"

stage="starting"
work_dir=""

alert() {
  [ -n "$ALERT_TO" ] || return 0
  printf 'To: %s\nSubject: 2anki database backup failed\n\nThe nightly backup stopped at: %s\nHost: %s\n' \
    "$ALERT_TO" "$stage" "$(hostname)" | sendmail -t ||
    echo "could not send the failure email" >&2
}

finish() {
  local status=$?
  [ -z "$work_dir" ] || rm -rf "$work_dir" || true
  if [ "$status" -ne 0 ]; then
    echo "backup failed at: $stage" >&2
    alert
  fi
  exit "$status"
}
trap finish EXIT

env_value() {
  local line
  line="$(grep -E "^(export )?$1=" "$ENV_FILE" | tail -1 | tr -d '\r')" || return 1
  [ -n "$line" ] || return 1
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

# Passed through the environment and split up, so the password never appears
# in a process listing.
read_connection() {
  DATABASE_URL="$1" python3 -c '
import os
import urllib.parse as parse
url = parse.urlsplit(os.environ["DATABASE_URL"])
print(parse.unquote(url.username or ""))
print(parse.unquote(url.password or ""))
print(url.hostname or "")
print(url.port or 5432)
print(url.path.lstrip("/"))
'
}

stage="reading configuration"
[ -n "$ALERT_TO" ] || ALERT_TO="$(env_value BACKUP_ALERT_EMAIL || true)"
[ -n "$ALERT_TO" ] || { echo "BACKUP_ALERT_EMAIL is not set" >&2; exit 1; }
[ -f "$PUBLIC_KEY" ] || { echo "no public key at $PUBLIC_KEY" >&2; exit 1; }
{
  read -r PGUSER
  read -r PGPASSWORD
  read -r PGHOST
  read -r PGPORT
  read -r PGDATABASE
} < <(read_connection "$(env_value DATABASE_URL)")
[ -n "$PGDATABASE" ] || { echo "no database name in DATABASE_URL" >&2; exit 1; }
export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
ENDPOINT="$(env_value SPACES_ENDPOINT)"
BUCKET="$(env_value SPACES_DEFAULT_BUCKET_NAME)"
AWS_ACCESS_KEY_ID="$(env_value AWS_ACCESS_KEY_ID)"
AWS_SECRET_ACCESS_KEY="$(env_value AWS_SECRET_ACCESS_KEY)"
AWS_DEFAULT_REGION="$(env_value SPACES_REGION)"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION

umask 077
mkdir -p "$WORK_ROOT"
# A run killed outright leaves its plain dump behind; never let one linger.
rm -rf "$WORK_ROOT"/run.*
work_dir="$(mktemp -d "$WORK_ROOT/run.XXXXXX")"
dump="$work_dir/dump"
encrypted="$work_dir/dump.gpg"

stage="dumping the database"
pg_dump --format=custom --no-owner --file="$dump"

stage="checking the dump can be read"
# awk reads to the end: grep -q would exit at the match and kill pg_restore
# with SIGPIPE, which pipefail reports as a failed backup.
pg_restore --list "$dump" | awk '/TABLE DATA public users/{found=1} END{exit !found}'

stage="encrypting the dump"
gpg --batch --yes --no-tty --trust-model always \
  --recipient-file "$PUBLIC_KEY" --output "$encrypted" --encrypt "$dump"
rm -f "$dump"

upload() {
  local key="backups/postgres/$1"
  stage="uploading $1"
  aws s3 cp --only-show-errors --endpoint-url "$ENDPOINT" \
    "$encrypted" "s3://$BUCKET/$key"

  stage="confirming $1 arrived whole"
  local local_size remote_size
  local_size="$(wc -c <"$encrypted" | tr -d ' ')"
  remote_size="$(aws s3api head-object --endpoint-url "$ENDPOINT" \
    --bucket "$BUCKET" --key "$key" --query ContentLength --output text)"
  [ "$local_size" = "$remote_size" ]
}

upload "daily-$(date -u +%a).dump.gpg"
if [ "$(date -u +%d)" = "01" ]; then
  upload "monthly-$(date -u +%Y-%m).dump.gpg"
fi

stage="done"
echo "backup finished: $(date -u +%FT%TZ)"
