#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
STATIC_DIR="$SCRIPT_DIR/backend/app/static/web"

echo "==> Building React frontend..."
cd "$FRONTEND_DIR"
pnpm build

echo "==> Clearing $STATIC_DIR..."
rm -rf "$STATIC_DIR"
mkdir -p "$STATIC_DIR"

echo "==> Copying build output..."
cp -r "$FRONTEND_DIR/dist/." "$STATIC_DIR/"

echo ""
echo "Done. Restart the backend to serve the new build."
echo ""
echo "To revert to the old dashboard at any time:"
echo "  git checkout -- backend/app/static/web/"
echo "  (then restart the backend)"
