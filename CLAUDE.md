Default to using Bun instead of Node.js.

- Use `bun test` for testing
- Use `bun install` for dependencies
- This is a monorepo using Bun workspaces
- Packages are under packages/

## Packages

- `@sable/sdk-core` — DOM capture, wireframes, action execution
- `@sable/sdk-live` — LiveKit voice/WebRTC connection
- `@sable/sdk-ui` — Call overlay, avatar, Sable button
- `@sable/sdk-nickel` — Nickel WebRTC stream + input forwarding
