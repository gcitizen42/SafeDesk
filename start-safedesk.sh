#!/bin/sh
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "$repo_dir" ] || ! cd -- "$repo_dir"; then
  printf '%s\n' 'Could not open the SafeDesk repository folder.' >&2
  status=1
else
  node "$repo_dir/scripts/safedesk/start.mjs" "$@"
  status=$?
fi
if [ "$status" -ne 0 ]; then
  printf '%s\n' 'SafeDesk stopped with an error. Review the message above.' >&2
  if [ -t 0 ]; then
    printf '%s' 'Press Enter to close: ' >&2
    IFS= read -r answer
  fi
fi
exit "$status"
