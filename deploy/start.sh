#!/bin/sh
# The job runner and web service may use different process namespaces.
set -eu
DEPLOY_ROOT="${MOVIEBOXD_DEPLOY_ROOT:-$HOME/movieboxd-deploy}"
export TRUST_HOSTING_PROXY=true
export MOVIEBOXD_DEPLOY_ROOT="$DEPLOY_ROOT"
exec node --max-old-space-size=24 "$DEPLOY_ROOT/supervisor.mjs"
