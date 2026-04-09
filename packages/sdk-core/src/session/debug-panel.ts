/**
 * Floating debug panel — "what the agent sees".
 *
 * When debug is on, we mount the vision capture canvas as a draggable
 * preview in the host page. The panel renders the *exact* pixels that get
 * encoded into the LiveKit video track, so "what you see in the panel" is
 * literally "what the agent sees". Position + minimized state persist in
 * `localStorage` so customers don't have to re-place the panel every
 * reload.
 *
 * Opt-in signals (any of these enables the panel):
 *   - `Sable.start({ debug: true })`
 *   - `?sable-debug=1` anywhere in the page URL
 *   - `localStorage.setItem('sable:debug', '1')`
 */

interface DebugPanelState {
  left?: number;
  top?: number;
  minimized?: boolean;
}

const DEBUG_PANEL_STATE_KEY = "sable:debug:panel";

function loadState(): DebugPanelState {
  try {
    const raw = window.localStorage?.getItem(DEBUG_PANEL_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DebugPanelState;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveState(state: DebugPanelState): void {
  try {
    window.localStorage?.setItem(DEBUG_PANEL_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * Opt-in check: does ANY of the debug signals say we should show the panel?
 * Called by the session before deciding whether to mount.
 */
export function shouldShowDebugPanel(debugOpt: boolean | undefined): boolean {
  if (debugOpt) return true;
  try {
    if (new URL(window.location.href).searchParams.get("sable-debug") === "1") {
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (window.localStorage?.getItem("sable:debug") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Mount `canvas` as a floating preview in the page. Returns a teardown that
 * removes the wrapper and detaches listeners.
 *
 * The wrapper is pointer-events:none by default; only the header bar and
 * its minimize button re-enable pointer events, so the panel never blocks
 * clicks on the underlying page.
 */
export function mountDebugPanel(canvas: HTMLCanvasElement): () => void {
  const state = loadState();

  const wrap = document.createElement("div");
  wrap.setAttribute("data-sable-debug", "vision");
  Object.assign(wrap.style, {
    position: "fixed",
    width: "240px",
    zIndex: "2147483647",
    background: "#111",
    color: "#ddd",
    border: "1px solid #444",
    borderRadius: "8px",
    font: "11px/1.3 system-ui, sans-serif",
    boxShadow: "0 8px 24px rgba(0,0,0,.4)",
    pointerEvents: "none",
    userSelect: "none",
    overflow: "hidden",
  } as Partial<CSSStyleDeclaration>);

  // Initial placement: restored from localStorage, else default top-right.
  if (typeof state.left === "number" && typeof state.top === "number") {
    wrap.style.left = `${state.left}px`;
    wrap.style.top = `${state.top}px`;
  } else {
    wrap.style.right = "12px";
    wrap.style.top = "12px";
  }

  // ── Header: drag handle + minimize button ────────────────────────────
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    padding: "6px 8px",
    background: "#1a1a1a",
    borderBottom: "1px solid #333",
    cursor: "move",
    pointerEvents: "auto",
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement("div");
  title.textContent = "sable: agent vision";
  Object.assign(title.style, {
    opacity: "0.75",
    fontWeight: "600",
    flex: "1",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  header.appendChild(title);

  const minBtn = document.createElement("button");
  minBtn.setAttribute("aria-label", "Minimize vision panel");
  Object.assign(minBtn.style, {
    background: "transparent",
    color: "#ddd",
    border: "1px solid #444",
    borderRadius: "4px",
    width: "20px",
    height: "20px",
    cursor: "pointer",
    fontSize: "12px",
    lineHeight: "1",
    padding: "0",
    pointerEvents: "auto",
  } as Partial<CSSStyleDeclaration>);
  header.appendChild(minBtn);

  wrap.appendChild(header);

  // ── Body: the capture canvas (click-through) ─────────────────────────
  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "6px",
    background: "#111",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);

  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.display = "block";
  canvas.style.background = "#fff";
  canvas.style.borderRadius = "4px";
  canvas.style.pointerEvents = "none";
  body.appendChild(canvas);

  wrap.appendChild(body);

  // ── Minimize state ───────────────────────────────────────────────────
  let minimized = !!state.minimized;
  const applyMinimized = (): void => {
    body.style.display = minimized ? "none" : "block";
    minBtn.textContent = minimized ? "▢" : "–";
    minBtn.setAttribute(
      "aria-label",
      minimized ? "Restore vision panel" : "Minimize vision panel",
    );
  };
  applyMinimized();

  minBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    minimized = !minimized;
    applyMinimized();
    saveState({ ...loadState(), minimized });
  });

  // ── Drag behaviour ───────────────────────────────────────────────────
  let dragState: { offsetX: number; offsetY: number } | null = null;

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.target instanceof HTMLElement && ev.target.closest("button")) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    dragState = {
      offsetX: ev.clientX - rect.left,
      offsetY: ev.clientY - rect.top,
    };
    // Convert to left/top anchoring on first drag.
    wrap.style.left = `${rect.left}px`;
    wrap.style.top = `${rect.top}px`;
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
    header.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragState) return;
    // Clamp so the panel can't be dragged fully off-screen (keep 24px of
    // the header visible on every edge so the user can always grab it).
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = wrap.offsetWidth;
    let left = ev.clientX - dragState.offsetX;
    let top = ev.clientY - dragState.offsetY;
    left = Math.min(Math.max(left, -w + 48), vw - 48);
    top = Math.min(Math.max(top, 0), vh - 24);
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (!dragState) return;
    dragState = null;
    try {
      header.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const left = parseFloat(wrap.style.left) || 0;
    const top = parseFloat(wrap.style.top) || 0;
    saveState({ ...loadState(), left, top });
  };

  header.addEventListener("pointerdown", onPointerDown);
  header.addEventListener("pointermove", onPointerMove);
  header.addEventListener("pointerup", onPointerUp);
  header.addEventListener("pointercancel", onPointerUp);

  document.body.appendChild(wrap);
  console.log("[Sable] debug vision panel mounted", {
    minimized,
    restoredPosition:
      typeof state.left === "number" && typeof state.top === "number",
  });

  return () => {
    try {
      header.removeEventListener("pointerdown", onPointerDown);
      header.removeEventListener("pointermove", onPointerMove);
      header.removeEventListener("pointerup", onPointerUp);
      header.removeEventListener("pointercancel", onPointerUp);
      wrap.remove();
    } catch {
      /* ignore */
    }
  };
}
