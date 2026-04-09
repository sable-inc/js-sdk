/**
 * Single source of truth for the SDK version string.
 *
 * Kept in a standalone file so build tooling (GitHub Actions release workflow)
 * can replace it at publish time without touching anything else.
 */

export const VERSION = "0.1.1";
