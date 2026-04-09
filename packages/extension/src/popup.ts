/// <reference types="chrome" />

const DEFAULT_API_URL = "https://sable-api-gateway-9dfmhij9.wl.gateway.dev";

const form = document.getElementById("sable-form") as HTMLFormElement;
const agentSelect = document.getElementById(
  "agent-select",
) as HTMLSelectElement;
const agentNewRow = document.getElementById("agent-new-row") as HTMLDivElement;
const agentNewInput = document.getElementById(
  "agent-new",
) as HTMLInputElement;
const apiInput = document.getElementById("api-url") as HTMLInputElement;
const injectBtn = document.getElementById("inject-btn") as HTMLButtonElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

const ADD_NEW = "__add__";

interface StoredState {
  agentIds?: string[];
  selectedAgentId?: string;
  apiUrl?: string;
}

function renderAgentOptions(ids: string[], selected?: string): void {
  // Rebuild options: saved IDs first, then the add-new sentinel.
  agentSelect.innerHTML = "";
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    agentSelect.appendChild(opt);
  }
  const addOpt = document.createElement("option");
  addOpt.value = ADD_NEW;
  addOpt.textContent = "+ Add new…";
  agentSelect.appendChild(addOpt);

  if (selected && ids.includes(selected)) {
    agentSelect.value = selected;
  } else if (ids.length > 0) {
    agentSelect.value = ids[0]!;
  } else {
    agentSelect.value = ADD_NEW;
  }
  updateNewRowVisibility();
}

function updateNewRowVisibility(): void {
  const isAdd = agentSelect.value === ADD_NEW;
  agentNewRow.hidden = !isAdd;
  agentNewInput.required = isAdd;
}

async function loadStored(): Promise<void> {
  const { agentIds, selectedAgentId, apiUrl } =
    (await chrome.storage.local.get([
      "agentIds",
      "selectedAgentId",
      "apiUrl",
    ])) as StoredState;
  renderAgentOptions(agentIds ?? [], selectedAgentId);
  apiInput.value = apiUrl ?? DEFAULT_API_URL;
}

async function saveStored(selectedAgentId: string): Promise<void> {
  const prev = (await chrome.storage.local.get(["agentIds"])) as StoredState;
  const existing = prev.agentIds ?? [];
  const agentIds = existing.includes(selectedAgentId)
    ? existing
    : [...existing, selectedAgentId];
  await chrome.storage.local.set({
    agentIds,
    selectedAgentId,
    apiUrl: apiInput.value,
  });
}

function resolveAgentId(): string {
  return agentSelect.value === ADD_NEW
    ? agentNewInput.value.trim()
    : agentSelect.value;
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function setBusy(busy: boolean): void {
  injectBtn.disabled = busy;
  startBtn.disabled = busy;
  stopBtn.disabled = busy;
}

type BgResponse = { ok: boolean; error?: string };

async function send(
  msg: Record<string, unknown>,
  pending: string,
  done: string,
): Promise<void> {
  setBusy(true);
  setStatus(pending);
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as BgResponse;
    if (res?.ok) {
      setStatus(done);
    } else {
      setStatus(`Error: ${res?.error ?? "unknown"}`);
    }
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
}

void loadStored();

agentSelect.addEventListener("change", () => {
  updateNewRowVisibility();
  if (agentSelect.value !== ADD_NEW) {
    void chrome.storage.local.set({ selectedAgentId: agentSelect.value });
  }
});
apiInput.addEventListener("change", () => {
  void chrome.storage.local.set({ apiUrl: apiInput.value });
});

injectBtn.addEventListener("click", async () => {
  await send(
    { type: "inject" },
    "Injecting SDK…",
    "SDK injected. window.Sable is live on this page.",
  );
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const agentId = resolveAgentId();
  if (!agentId) {
    setStatus("Error: agent ID is required");
    return;
  }
  await saveStored(agentId);
  // If the user just added a new ID, re-render so it shows up in the list.
  if (agentSelect.value === ADD_NEW) {
    const { agentIds } = (await chrome.storage.local.get([
      "agentIds",
    ])) as StoredState;
    renderAgentOptions(agentIds ?? [], agentId);
    agentNewInput.value = "";
  }
  await send(
    {
      type: "start",
      agentId,
      apiUrl: apiInput.value || DEFAULT_API_URL,
    },
    "Starting…",
    "Live. Talk to the agent. Check the page console for events.",
  );
});

stopBtn.addEventListener("click", async () => {
  await send({ type: "stop" }, "Stopping…", "Stopped.");
});
