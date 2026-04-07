/// <reference types="chrome" />

const btn = document.getElementById("inject-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

btn.addEventListener("click", async () => {
  statusEl.textContent = "Injecting…";
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "inject" });
    if (res?.ok) {
      statusEl.textContent = "Injected. Open the page DevTools console.";
    } else {
      statusEl.textContent = `Error: ${res?.error ?? "unknown"}`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    btn.disabled = false;
  }
});
