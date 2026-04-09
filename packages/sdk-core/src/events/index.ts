/**
 * Typed event emitter for the SDK's public event surface.
 *
 * Intentionally tiny — one map, one loop, no dependency on any EventTarget
 * polyfill. We keep fire-and-forget semantics: handler exceptions are caught
 * and logged so one misbehaving subscriber can't break the session.
 */

import type { SableEventHandler, SableEvents } from "../types";

type HandlerSet<E extends keyof SableEvents> = Set<SableEventHandler<E>>;

export class SableEventEmitter {
  // Map of event name → set of handlers. Any-typed because TS can't express
  // "Map<K, Set<Handler<K>>>" cleanly; we gate access through the typed
  // `on`/`emit` methods below.
  private readonly listeners = new Map<keyof SableEvents, Set<unknown>>();

  on<E extends keyof SableEvents>(
    event: E,
    handler: SableEventHandler<E>,
  ): () => void {
    let set = this.listeners.get(event) as HandlerSet<E> | undefined;
    if (!set) {
      set = new Set<SableEventHandler<E>>();
      this.listeners.set(event, set as unknown as Set<unknown>);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit<E extends keyof SableEvents>(event: E, payload: SableEvents[E]): void {
    const set = this.listeners.get(event) as HandlerSet<E> | undefined;
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.warn(`[Sable] event handler for "${String(event)}" threw`, err);
      }
    }
  }

  /** Drop every handler. Called on session teardown to avoid leaks. */
  clear(): void {
    this.listeners.clear();
  }
}
