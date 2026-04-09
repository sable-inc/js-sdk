/**
 * Clipboard runtime methods.
 *
 * `sendToolMessage` and its legacy alias `sendCopyableText` carry text the
 * user is supposed to act on (URLs, code snippets, prompts). Parley renders
 * them as chat bubbles; the standalone SDK has no chat surface, so we copy
 * to the clipboard so the user can ⌘V into whatever the agent is guiding
 * them through. URL wins over message when both are present — agents put
 * explanatory text in `message` and the actual thing-to-copy in `url`.
 */

export async function handleCopyable(
  rpcName: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const message = typeof payload.message === "string" ? payload.message : "";
  const url = typeof payload.url === "string" ? payload.url : "";
  const toCopy = url || message;

  if (!toCopy) {
    console.warn(`[Sable] ${rpcName}: empty payload, nothing to copy`);
    return { success: false, error: "empty payload" };
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(toCopy);
      return { success: true };
    }
    // execCommand fallback for contexts without async clipboard API
    // (e.g. insecure origins, older webviews).
    const ta = document.createElement("textarea");
    ta.value = toCopy;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("execCommand copy returned false");
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sable] ${rpcName}: copy failed`, msg);
    return { success: false, error: msg };
  }
}
