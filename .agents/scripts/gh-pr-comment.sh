#!/usr/bin/env bash
# The only path through which agents write to pull requests without a confirmation prompt.
# .claude/settings.json allows this script instead of `gh api` itself, because a wildcard on
# `gh api` also matches merges, deletions and posting arbitrary files. Everything that decides
# what is written (repository, endpoint, method, body source) is therefore fixed or validated
# here, and no other gh arguments are accepted.
#
#   gh-pr-comment.sh reply   <pr-number> <review-comment-id> <body-file>
#   gh-pr-comment.sh resolve <pr-number> <review-comment-id>
#   gh-pr-comment.sh comment <pr-number> <body-file>   (also accepts an issue number)
#
# <body-file> must be a regular, single-link file inside the repository's .temp/ directory.
# It is opened once and validated through that open descriptor, then passed to gh as a string,
# so swapping the file or a parent directory after the check cannot change what gets posted.
set -euo pipefail

readonly MAX_BODY_BYTES=65536

die() {
  echo "gh-pr-comment: $*" >&2
  exit 2
}

usage() {
  die "usage: gh-pr-comment.sh reply <pr> <comment-id> <body-file> | resolve <pr> <comment-id> | comment <pr> <body-file>"
}

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)

number() { # name value max_digits
  [[ "$2" =~ ^[1-9][0-9]{0,$(($3 - 1))}$ ]] || die "$1 must be a positive integer: $2"
}

read_body() {
  [[ ! -L "$1" ]] || die "body file must not be a symlink: $1"
  # Checked before open so a FIFO or device cannot block or trigger side effects; the
  # authoritative checks below run on the open descriptor.
  [[ -f "$1" ]] || die "body file must be a regular file: $1"
  { exec 3<"$1"; } 2>/dev/null || die "body file not readable: $1"
  local fd=/proc/self/fd/3 real links size body
  real=$(realpath -e -- "$fd") || die "cannot resolve body file: $1"
  case "$real" in
    "$root/.temp/"*) ;;
    *) die "body file must be inside $root/.temp/: $1" ;;
  esac
  [[ -f "$fd" ]] || die "body file must be a regular file: $1"
  links=$(stat -L -c %h -- "$fd")
  ((links == 1)) || die "body file must not be a hard link: $1"
  size=$(stat -L -c %s -- "$fd")
  ((size <= MAX_BODY_BYTES)) || die "body file exceeds $MAX_BODY_BYTES bytes: $1"
  # Bounded read: the file could still grow after the size check.
  body=$(LC_ALL=C head -c "$MAX_BODY_BYTES" <&3)
  ((${#body} > 0)) || die "body file is empty: $1"
  printf '%s' "$body"
}

repo_slug() {
  local url slug
  url=$(git -C "$root" remote get-url origin 2>/dev/null) || die "no origin remote"
  case "$url" in
    https://github.com/*) slug=${url#https://github.com/} ;;
    git@github.com:*) slug=${url#git@github.com:} ;;
    ssh://git@github.com/*) slug=${url#ssh://git@github.com/} ;;
    *) die "origin is not a github.com repository" ;;
  esac
  slug=${slug%.git}
  [[ "$slug" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "unexpected repository name: $slug"
  case "/$slug/" in
    */./* | */../*) die "unexpected repository name: $slug" ;;
  esac
  printf '%s' "$slug"
}

(($# >= 1)) || usage
op=$1
shift

case "$op" in
  reply)
    (($# == 3)) || usage
    number "pr" "$1" 10
    number "comment-id" "$2" 20
    body=$(LC_ALL=C read_body "$3")
    slug=$(repo_slug)
    exec gh api --hostname github.com --method POST \
      "repos/$slug/pulls/$1/comments/$2/replies" -f "body=$body" --jq .html_url
    ;;
  resolve)
    (($# == 2)) || usage
    number "pr" "$1" 10
    number "comment-id" "$2" 20
    slug=$(repo_slug)
    # Not a public GitHub REST endpoint: Claude Code on the web's GitHub proxy provides it
    # because GraphQL (resolveReviewThread) is unavailable from those sessions.
    exec gh api --hostname github.com --method POST \
      "repos/$slug/pulls/$1/ccr/comments/$2/resolve"
    ;;
  comment)
    (($# == 2)) || usage
    number "pr" "$1" 10
    body=$(LC_ALL=C read_body "$2")
    slug=$(repo_slug)
    exec gh api --hostname github.com --method POST \
      "repos/$slug/issues/$1/comments" -f "body=$body" --jq .html_url
    ;;
  *)
    usage
    ;;
esac
