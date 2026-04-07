/// <reference types="chrome" />

const DEFAULT_API_URL = "https://sable-api-gateway-9dfmhij9.wl.gateway.dev";

const form = document.getElementById("sable-form") as HTMLFormElement;
const agentInput = document.getElementById("agent-id") as HTMLInputElement;
const apiInput = document.getElementById("api-url") as HTMLInputElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

interface StoredState {
  agentId?: string;
  apiUrl?: string;
}

async function loadStored(): Promise<void> {
  const { agentId, apiUrl } = (await chrome.storage.local.get([
    "agentId",
    "apiUrl",
  ])) as StoredState;
  if (agentId) agentInput.value = agentId;
  apiInput.value = apiUrl ?? DEFAULT_API_URL;
}

async function saveStored(): Promise<void> {
  await chrome.storage.local.set({
    agentId: agentInput.value,
    apiUrl: apiInput.value,
  });
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function setBusy(busy: boolean): void {
  startBtn.disabled = busy;
  stopBtn.disabled = busy;
}

void loadStored();

agentInput.addEventListener("change", () => void saveStored());
apiInput.addEventListener("change", () => void saveStored());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveStored();
  setBusy(true);
  setStatus("Starting…");
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "start",
      agentId: agentInput.value,
      apiUrl: apiInput.value || DEFAULT_API_URL,
    })) as { ok: boolean; error?: string };
    if (res?.ok) {
      setStatus("Live. Talk to the agent. Check the page console for events.");
    } else {
      setStatus(`Error: ${res?.error ?? "unknown"}`);
    }
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
});

stopBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Stopping…");
  try {
    const res = (await chrome.runtime.sendMessage({ type: "stop" })) as {
      ok: boolean;
      error?: string;
    };
    if (res?.ok) {
      setStatus("Stopped.");
    } else {
      setStatus(`Error: ${res?.error ?? "unknown"}`);
    }
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
});
