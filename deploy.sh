#!/usr/bin/env bash
# Deploy on the Charras home server. Run on the box, from the checkout in /opt/web-erg.
# Full recipe (container, port, Tailscale Funnel path): isc/home-infra, charras/SETUP.md §15.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/web-erg}
RUBY_IMAGE=${RUBY_IMAGE:-ruby:3.4}

git -C "$APP_DIR" pull --ff-only
# Gems live on disk in $APP_DIR/vendor/bundle (gitignored), not in the container: the container is
# disposable, `docker restart` must not re-run a full install.
sudo docker run --rm -v "$APP_DIR":/app -w /app \
  -e BUNDLE_PATH=/app/vendor/bundle -e BUNDLE_WITHOUT=development:test \
  "$RUBY_IMAGE" bundle install
sudo docker restart web-erg
