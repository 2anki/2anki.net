#!/bin/bash
# Encrypted Postgres backup to DigitalOcean Spaces, run nightly from cron.
#
# The box only holds the public key, so a stolen box or bucket cannot read a
# dump. The private key stays with the owner, outside this repo and this box.
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
# Needs: BACKUP_ALERT_EMAIL, and the public key at BACKUP_PUBLIC_KEY.
set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-$HOME/src/github.com/2anki/2anki.net/.env}"
PUBLIC_KEY="${BACKUP_PUBLIC_KEY:-$HOME/.config/2anki-backup/public.asc}"
WORK_ROOT="${BACKUP_WORK_ROOT:-$HOME/.cache/2anki-backup}"
ALERT_TO="${BACKUP_ALERT_EMAIL:-}"
export PATH="$HOME/.local/bin:$PATH"

stage="starting"
work_dir=""

alert() {
  [ -n "$ALERT_TO" ] || return 0
  printf 'To: %s\nSubject: 2anki database backup failed\n\nThe nightly backup stopped at: %s\nHost: %s\n' \
    "$ALERT_TO" "$stage" "$(hostname)" | sendmail -t || true
}

finish() {
  local status=$?
  [ -z "$work_dir" ] || rm -rf "$work_dir"
  if [ "$status" -ne 0 ]; then
    echo "backup failed at: $stage" >&2
    alert
  fi
  exit "$status"
}
trap finish EXIT

env_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | head -1)" || return 1
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

stage="reading configuration"
[ -n "$ALERT_TO" ] || { echo "BACKUP_ALERT_EMAIL is not set" >&2; exit 1; }
[ -f "$PUBLIC_KEY" ] || { echo "no public key at $PUBLIC_KEY" >&2; exit 1; }
DATABASE_URL="$(env_value DATABASE_URL)"
ENDPOINT="$(env_value SPACES_ENDPOINT)"
BUCKET="$(env_value SPACES_DEFAULT_BUCKET_NAME)"
AWS_ACCESS_KEY_ID="$(env_value AWS_ACCESS_KEY_ID)"
AWS_SECRET_ACCESS_KEY="$(env_value AWS_SECRET_ACCESS_KEY)"
AWS_DEFAULT_REGION="$(env_value SPACES_REGION)"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION

umask 077
mkdir -p "$WORK_ROOT"
work_dir="$(mktemp -d "$WORK_ROOT/run.XXXXXX")"
dump="$work_dir/dump"
encrypted="$work_dir/dump.gpg"

stage="dumping the database"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$dump"

stage="checking the dump can be read"
pg_restore --list "$dump" | grep -q 'TABLE DATA public users'

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
