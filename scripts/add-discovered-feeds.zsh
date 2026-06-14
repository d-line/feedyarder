#!/usr/bin/env zsh

set -u
setopt pipe_fail
setopt extended_glob

function usage() {
  cat <<'EOF'
Usage:
  FEEDYARDER_SESSION=... scripts/add-discovered-feeds.zsh URL_FILE FOLDER_ID

Optional environment variables:
  FEEDYARDER_API_URL  API base URL (default: http://10.0.1.26:3001)

The URL file must contain one website URL per line. Blank lines and lines
starting with "#" are ignored.
EOF
}

if (( $# != 2 )); then
  usage >&2
  exit 2
fi

url_file=$1
folder_id=$2
api_url=${FEEDYARDER_API_URL:-http://10.0.1.26:3001}
session=${FEEDYARDER_SESSION:-}

if [[ ! -r $url_file ]]; then
  print -u2 -- "Cannot read URL file: $url_file"
  exit 2
fi

if [[ -z $folder_id ]]; then
  print -u2 -- "FOLDER_ID must not be empty"
  exit 2
fi

if [[ -z $session ]]; then
  print -u2 -- "FEEDYARDER_SESSION must be set"
  exit 2
fi

for dependency in http jq; do
  if ! command -v $dependency >/dev/null 2>&1; then
    print -u2 -- "Required command not found: $dependency"
    exit 2
  fi
done

api_url=${api_url%/}
processed=0
added=0
failed=0

while IFS= read -r raw_url || [[ -n $raw_url ]]; do
  url=${${raw_url##[[:space:]]#}%%[[:space:]]#}

  if [[ -z $url || $url == \#* ]]; then
    continue
  fi

  (( processed += 1 ))
  print -- "[$processed] Discovering: $url"

  if ! discovery_response=$(
    http --check-status --ignore-stdin --print=b \
      POST "$api_url/feeds/discover" \
      "Cookie:feedyarder_session=$session" \
      url="$url" 2>&1
  ); then
    print -u2 -- "  Discovery failed: $discovery_response"
    (( failed += 1 ))
    continue
  fi

  if ! feed_url=$(jq -er '.feeds[0].feedUrl // empty' <<< "$discovery_response" 2>/dev/null); then
    print -u2 -- "  No feed URL found in discovery response"
    (( failed += 1 ))
    continue
  fi

  print -- "  Adding: $feed_url"

  if ! add_response=$(
    http --check-status --ignore-stdin --print=b \
      POST "$api_url/feeds" \
      "Cookie:feedyarder_session=$session" \
      feedUrl="$feed_url" \
      folderId="$folder_id" 2>&1
  ); then
    print -u2 -- "  Add failed: $add_response"
    (( failed += 1 ))
    continue
  fi

  (( added += 1 ))
  print -- "  Added"
done < "$url_file"

print
print -- "Processed: $processed; added: $added; failed: $failed"

(( failed == 0 ))
