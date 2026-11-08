#!/bin/sh
# Copies this case's workspace/ fixture into the run's working directory and installs its
# dependencies (the scaffold runs outside the agent's sandbox; Bash in the run has no network).
set -e
cp -R "$(dirname "$0")/workspace/." .
npm install --no-audit --no-fund --ignore-scripts --loglevel=error
