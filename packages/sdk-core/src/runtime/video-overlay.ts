/**
 * Default `switchView({ mode: "video", url })` implementation.
 *
 * Mounts a centred floating video clip in the page. Host apps with their own
 * call UI would override `switchView` in `runtime` to render into their own
 * surface; the standalone SDK uses this simple overlay as the built-in
 * default so agents that call `switchView` Just Work out of the box.
 *
 * Module-level state (`activeViewOverlay`) keeps at most one overlay mounted
 * — calling `mountVideoOverlay` while another is showing tears the old one
 * down first.
 */

let activeViewOverlay: HTMLDivElement | null = null;

export function removeViewOverlay(): void {
  if (activeViewOverlay) {
    activeViewOverlay.remove();
    activeViewOverlay = null;
  }
}

export function mountVideoOverlay(url: string): void {
  removeViewOverlay();

  const overlay = document.createElement("div");
  overlay.setAttribute("data-sable", "view-overlay");
  Object.assign(overlay.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: "2147483646",
    background: "rgba(0, 0, 0, 0.85)",
    borderRadius: "12px",
    padding: "8px",
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.5)",
    maxWidth: "min(80vw, 960px)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  } as Partial<CSSStyleDeclaration>);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close video");
  Object.assign(closeBtn.style, {
    alignSelf: "flex-end",
    background: "rgba(255,255,255,0.15)",
    color: "white",
    border: "none",
    borderRadius: "999px",
    width: "28px",
    height: "28px",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "1",
  } as Partial<CSSStyleDeclaration>);
  closeBtn.addEventListener("click", removeViewOverlay);

  const video = document.createElement("video");
  video.src = url;
  video.controls = false;
  video.autoplay = true;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.setAttribute(
    "controlslist",
    "nodownload nofullscreen noremoteplayback noplaybackrate",
  );
  Object.assign(video.style, {
    maxWidth: "100%",
    maxHeight: "70vh",
    borderRadius: "8px",
    display: "block",
  } as Partial<CSSStyleDeclaration>);

  const onEnded = (): void => {
    if (activeViewOverlay === overlay) {
      removeViewOverlay();
    }
  };
  video.addEventListener("ended", onEnded);

  overlay.appendChild(closeBtn);
  overlay.appendChild(video);
  document.body.appendChild(overlay);
  activeViewOverlay = overlay;

  video.play().catch((e) => {
    console.warn("[Sable] switchView video autoplay blocked", e);
  });
}
