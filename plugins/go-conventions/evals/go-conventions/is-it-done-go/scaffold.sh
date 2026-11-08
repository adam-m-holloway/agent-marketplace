#!/bin/sh
# Copies this case's workspace/ fixture into the run's working directory. Go in the run's
# sandbox has no network and cannot write to HOME: use local toolchain, no module downloads and
# caches in the workspace. Only touches a temporary HOME, never yours.
set -e
cp -R "$(dirname "$0")/workspace/." .
if command -v go >/dev/null 2>&1; then
  case "$HOME" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
      go env -w GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOCACHE="$PWD/.cache/go-build" GOPATH="$PWD/.cache/go" ;;
  esac
fi
