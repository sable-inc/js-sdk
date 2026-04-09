#!/usr/bin/env bash
# Stage the built SDK into the Cloudflare Pages deploy directory.
#
# Usage: infra/cdn/stage.sh <version>
#
# Expects packages/sdk-core/dist/sable.iife.js to exist (run `bun run build`
# first). Produces infra/cdn/public/ laid out as described in the README:
#
#   infra/cdn/public/
#   ├── _headers
#   ├── v<version>/sable.js
#   ├── v<major>/sable.js        # minor-pinned (v1 for 0.x, v2 for 1.x, ...)
#   └── latest/sable.js
#
# The output directory is clobbered on each run — this script is meant to be
# called fresh from CI, not to manage persistent state.

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>" >&2
  exit 1
fi

# Allow the tag to include the leading `v` without duplicating it.
VERSION="${VERSION#v}"

# Derive the minor-pin path. 0.x releases all live under /v1/ because we
# treat the whole 0.x line as one major for public API purposes; once we
# ship 1.0 the pin becomes /v2/, etc.
MAJOR="${VERSION%%.*}"
if [ "$MAJOR" = "0" ]; then
  PIN="v1"
else
  PIN="v$((MAJOR + 1))"
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/packages/sdk-core/dist/sable.iife.js"
OUT="$ROOT/infra/cdn/public"

if [ ! -f "$SRC" ]; then
  echo "error: $SRC not found — run 'bun run build' in packages/sdk-core first" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/v$VERSION" "$OUT/$PIN" "$OUT/latest"

cp "$SRC" "$OUT/v$VERSION/sable.js"
cp "$SRC" "$OUT/$PIN/sable.js"
cp "$SRC" "$OUT/latest/sable.js"
cp "$ROOT/infra/cdn/_headers" "$OUT/_headers"

echo "staged sdk-core v$VERSION → $OUT"
echo "  /v$VERSION/sable.js"
echo "  /$PIN/sable.js (minor pin)"
echo "  /latest/sable.js"
