#!/usr/bin/env bash
# Stage the built SDK into the Cloudflare Pages deploy directory.
#
# Usage: infra/cdn/stage.sh <version>
#
# Expects packages/sdk-core/dist/sable.iife.js and sable-core.mjs to exist
# (run `bun run build` first). Produces infra/cdn/public/ laid out as
# described in the README:
#
#   infra/cdn/public/
#   ├── _headers
#   ├── v<version>/{sable.js,sable-core.mjs}
#   ├── v<major>/{sable.js,sable-core.mjs}   # minor-pinned (v1 for 0.x, ...)
#   └── latest/{sable.js,sable-core.mjs}
#
# The loader (sable.js) resolves its core bundle via
# `new URL("./sable-core.mjs", document.currentScript.src)`, so the two
# files MUST live side-by-side under every pin.
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
LOADER="$ROOT/packages/sdk-core/dist/sable.iife.js"
CORE="$ROOT/packages/sdk-core/dist/sable-core.mjs"
OUT="$ROOT/infra/cdn/public"

for f in "$LOADER" "$CORE"; do
  if [ ! -f "$f" ]; then
    echo "error: $f not found — run 'bun run build' in packages/sdk-core first" >&2
    exit 1
  fi
done

rm -rf "$OUT"
mkdir -p "$OUT/v$VERSION" "$OUT/$PIN" "$OUT/latest"

for dir in "v$VERSION" "$PIN" "latest"; do
  cp "$LOADER" "$OUT/$dir/sable.js"
  cp "$CORE"   "$OUT/$dir/sable-core.mjs"
done
cp "$ROOT/infra/cdn/_headers" "$OUT/_headers"

echo "staged sdk-core v$VERSION → $OUT"
for dir in "v$VERSION" "$PIN" "latest"; do
  echo "  /$dir/sable.js + sable-core.mjs"
done
