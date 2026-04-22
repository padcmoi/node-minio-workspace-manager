import { apiRequest, byId, createOutputWriter, setNavActive, sharedPageShell, withBusy } from "/public/js/common.js";

sharedPageShell({
  title: "POC MinIO Workspace Manager",
  subtitle: "Stats page",
  activeNav: "stats",
});

const outputEl = byId("output");
const metricsCardsEl = byId("metricsCards");
const metricsRawEl = byId("metricsRaw");
const writeOutput = createOutputWriter(outputEl);

function renderMetrics(metrics) {
  if (!metrics) {
    metricsCardsEl.innerHTML =
      '<div class="rounded border border-slate-800 bg-slate-900 p-3 text-slate-400">No metrics loaded.</div>';
    metricsRawEl.textContent = "";
    return;
  }

  const rawInfo = metrics?.raw?.info ?? {};
  const firstServer = Array.isArray(rawInfo?.servers) ? (rawInfo.servers[0] ?? {}) : {};

  const cards = [
    { label: "Version", value: String(metrics.server?.version ?? firstServer?.version ?? "n/a") },
    { label: "Mode", value: String(metrics.server?.mode ?? rawInfo?.mode ?? "n/a") },
    { label: "Region", value: String(metrics.server?.region ?? rawInfo?.region ?? "n/a") },
    { label: "Uptime", value: String(metrics.server?.uptime ?? firstServer?.uptime ?? "n/a") },
    { label: "Objects", value: String(metrics.usage?.objects ?? 0) },
    { label: "Usage (bytes)", value: String(metrics.usage?.usage ?? 0) },
  ];

  metricsCardsEl.innerHTML = cards
    .map(
      (c) =>
        `<div class="rounded border border-slate-800 bg-slate-900 p-3"><div class="text-xs text-slate-400">${c.label}</div><div class="mt-1 text-sm font-semibold">${c.value}</div></div>`
    )
    .join("");

  metricsRawEl.textContent = JSON.stringify(metrics, null, 2);
}

async function loadMetrics() {
  const data = await apiRequest({ method: "GET", path: "/api/admin/metrics", writeOutput });
  renderMetrics(data);
}

async function health() {
  await apiRequest({ method: "GET", path: "/api/health", writeOutput });
}

byId("btnHealth").addEventListener("click", () => {
  void withBusy(byId("btnHealth"), health).catch((error) => {
    writeOutput("ERROR", "HEALTH", String(error?.message || error));
  });
});

byId("btnMetrics").addEventListener("click", () => {
  void withBusy(byId("btnMetrics"), loadMetrics).catch((error) => {
    writeOutput("ERROR", "METRICS", String(error?.message || error));
  });
});

byId("btnCopyOutput").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputEl.textContent || "");
    writeOutput("OK", "COPY", "Output copied");
  } catch {
    writeOutput("WARN", "COPY", "Clipboard unavailable");
  }
});

byId("btnClearOutput").addEventListener("click", () => {
  outputEl.textContent = "";
});

setNavActive("stats");
writeOutput("INFO", "READY", "Stats page loaded");
void loadMetrics();
