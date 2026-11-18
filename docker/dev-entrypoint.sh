#!/bin/sh
# Installiert Abhängigkeiten in die node_modules-Volumes, bevor der eigentliche Befehl läuft.
set -e
if [ -n "$CI" ]; then
  pnpm install --frozen-lockfile --prefer-offline
else
  pnpm install --prefer-offline
fi
exec "$@"
