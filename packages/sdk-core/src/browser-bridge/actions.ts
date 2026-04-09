/**
 * Action dispatcher for `browser.execute_action`.
 *
 * The canonical wire contract lives in the Python bridge
 * (`sable_agentkit/components/browser/bridges/wire.py`). The `kind` tag and
 * payload shape of each variant must stay in lock-step with it — if a new
 * action lands on the Python side, mirror it here.
 *
 * Target resolution: actions can target an element either by CSS selector
 * string or by `{ x, y }` coordinates (for vision-driven clicks where the
 * agent only knows pixel positions). See `resolveTarget`.
 */

interface Coordinates {
  x: number;
  y: number;
}

function isCoordinates(p: unknown): p is Coordinates {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as Coordinates).x === "number" &&
    typeof (p as Coordinates).y === "number"
  );
}

/**
 * Resolve an Action.payload to a target element.
 *   - `{ x, y }` → `document.elementFromPoint`
 *   - selector string → `document.querySelector`
 */
function resolveTarget(payload: unknown): Element | null {
  if (isCoordinates(payload)) {
    return document.elementFromPoint(payload.x, payload.y);
  }
  if (typeof payload === "string") {
    try {
      return document.querySelector(payload);
    } catch {
      return null;
    }
  }
  return null;
}

export interface ActionEnvelope {
  kind: string;
  payload?: unknown;
  // common variants
  button?: string;
  key?: string;
  text?: string;
  delay?: number;
  replace?: boolean;
  url?: string;
  expression?: string;
  start?: unknown;
  end?: unknown;
  steps?: number;
}

export async function dispatchAction(action: ActionEnvelope): Promise<void> {
  switch (action.kind) {
    case "click": {
      const el = resolveTarget(action.payload);
      if (!el) throw new Error(`click: target not found`);
      (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
      (el as HTMLElement).click();
      return;
    }
    case "hover": {
      const el = resolveTarget(action.payload);
      if (!el) return;
      el.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, cancelable: true }),
      );
      return;
    }
    case "type": {
      const el = resolveTarget(action.payload);
      if (!el) throw new Error(`type: target not found`);
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      input.focus();
      if (action.replace) {
        input.value = "";
      }
      const text = action.text ?? "";
      // Use the native setter so React/Vue controlled inputs see the change.
      const proto =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(input, (input.value ?? "") + text);
      } else {
        input.value = (input.value ?? "") + text;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    case "key": {
      const target = (document.activeElement ?? document.body) as HTMLElement;
      const key = action.key ?? "";
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
      );
      return;
    }
    case "clear": {
      const el = document.activeElement as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (!el || !("value" in el)) return;
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    case "navigate": {
      const url = action.url ?? "";
      if (!url) return;
      // Same-URL is a no-op so the agent can re-issue navigate cheaply.
      if (url === window.location.href) return;
      // Full-document navigation tears down the SDK; for v0 the SDK is
      // expected to live inside the destination page already, so log
      // and best-effort assign. The extension/host must re-inject after
      // the new document loads.
      console.warn(
        "[Sable] browser.navigate will reload the page; SDK must be re-injected on the new document",
        { url },
      );
      window.location.assign(url);
      return;
    }
    case "evaluate": {
      const expr = action.expression ?? "";
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      (0, eval)(expr);
      return;
    }
    // Visual-only actions are no-ops for v0; they exist on Nickel for the
    // server-rendered demo recordings, not for an SDK-driven user browser.
    case "highlight_box":
    case "highlight_text":
    case "select_text":
    case "center_scroll":
    case "drag":
    case "hide_cursor":
    case "show_cursor":
      return;
    default:
      throw new Error(`unsupported action kind: ${action.kind}`);
  }
}
