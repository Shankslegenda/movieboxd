#!/bin/sh
# alwaysdata restarts this managed process after deployment sends SIGTERM.
set -eu
DEPLOY_ROOT="${MOVIEBOXD_DEPLOY_ROOT:-$HOME/movieboxd-deploy}"
cd "$DEPLOY_ROOT/current"
printf '%s\n' "$$" > "$DEPLOY_ROOT/app.pid"
export TRUST_HOSTING_PROXY=true
exec node server/index.ts
