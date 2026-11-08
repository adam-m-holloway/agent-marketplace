#!/bin/sh
# Copies this case's workspace/ fixture into the run's empty working directory.
set -e
cp -R "$(dirname "$0")/workspace/." .
