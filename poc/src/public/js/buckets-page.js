import {
  apiRequest,
  byId,
  createOutputWriter,
  guessStoreIdFromBucket,
  sharedPageShell,
  withBusy,
  workspaceNameFromBucket,
} from "/public/js/common.js";

sharedPageShell({
  title: "POC MinIO Workspace Manager",
  subtitle: "Buckets list and bucket management",
  activeNav: "buckets",
});

const outputEl = byId("output");
const bucketsTableEl = byId("bucketsTable");
const bucketInfoRawEl = byId("bucketInfoRaw");
const writeOutput = createOutputWriter(outputEl);

const state = {
  buckets: [],
};

const STORE_WORKSPACE_PREFIX = "store-";

function toWorkspaceName(value) {
  let normalized = String(value || "").trim();
  if (!normalized) return "";

  if (normalized.startsWith("bucket-")) normalized = normalized.slice("bucket-".length);
  if (normalized.startsWith("user-")) normalized = normalized.slice("user-".length);

  if (normalized.startsWith(STORE_WORKSPACE_PREFIX)) return normalized;
  return `${STORE_WORKSPACE_PREFIX}${normalized}`;
}

function toStoreId(value) {
  let normalized = String(value || "").trim();
  if (!normalized) return "";

  if (normalized.startsWith("bucket-")) normalized = normalized.slice("bucket-".length);
  if (normalized.startsWith("user-")) normalized = normalized.slice("user-".length);
  if (normalized.startsWith(STORE_WORKSPACE_PREFIX)) normalized = normalized.slice(STORE_WORKSPACE_PREFIX.length);

  return normalized;
}

function setBucketNameInputFromWorkspace(value) {
  byId("bucketName").value = toStoreId(value);
}

function workspaceNameFromRow(row) {
  const username = typeof row?.username === "string" ? row.username.trim() : "";
  if (username.startsWith("user-")) return username.slice("user-".length);
  return workspaceNameFromBucket(row?.bucket ?? "");
}

function renderBuckets() {
  if (!Array.isArray(state.buckets) || state.buckets.length === 0) {
    bucketsTableEl.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-center text-slate-400">No bucket found.</td></tr>';
    return;
  }

  bucketsTableEl.innerHTML = state.buckets
    .map((workspace) => {
      const bucket = workspace?.bucket ?? "";
      const workspaceName = workspaceNameFromRow(workspace);
      const storeId = guessStoreIdFromBucket(bucket);
      const quotaHard = workspace?.quota?.hard ?? "-";
      const quotaUsage = workspace?.quota?.usage ?? 0;

      const useHref = storeId ? `/bucket/${encodeURIComponent(storeId)}` : "";
      const status = String(workspace?.userStatus ?? "").toLowerCase();

      const useAction = !storeId
        ? '<span class="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-500">Use (n/a)</span>'
        : status === "enabled"
          ? `<a href="${useHref}" class="rounded bg-slate-700 px-2 py-1 text-[11px] hover:bg-slate-600">Use</a>`
          : '<span class="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-500">Use</span>';
      const toggleAction = !workspaceName
        ? '<span class="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-500">Toggle (n/a)</span>'
        : status === "enabled"
          ? `<button data-workspace="${workspaceName}" data-bucket="${bucket}" data-enabled="false" class="btnSetBucketEnabledInline rounded bg-amber-500 px-2 py-1 text-[11px] font-medium text-slate-950 hover:bg-amber-400">Disable</button>`
          : status === "disabled"
            ? `<button data-workspace="${workspaceName}" data-bucket="${bucket}" data-enabled="true" class="btnSetBucketEnabledInline rounded bg-emerald-500 px-2 py-1 text-[11px] font-medium text-slate-950 hover:bg-emerald-400">Enable</button>`
            : '<span class="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-500">Toggle (n/a)</span>';

      return `
        <tr class="border-t border-slate-800">
          <td class="px-2 py-2 font-medium">${bucket}</td>
          <td class="px-2 py-2">${workspace?.userStatus ?? "unknown"}</td>
          <td class="px-2 py-2">${workspace?.objects ?? 0}</td>
          <td class="px-2 py-2">${quotaUsage} / ${quotaHard}</td>
          <td class="px-2 py-2">
            <div class="flex gap-1">
              ${toggleAction}
              ${useAction}
              <button data-workspace="${workspaceName}" data-bucket="${bucket}" class="btnDeleteBucketInline rounded bg-rose-700 px-2 py-1 text-[11px] hover:bg-rose-600">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  for (const button of bucketsTableEl.querySelectorAll(".btnDeleteBucketInline")) {
    button.addEventListener("click", () => {
      const workspace = button.getAttribute("data-workspace") || "";
      const bucket = button.getAttribute("data-bucket") || "";

      setBucketNameInputFromWorkspace(workspace);
      void withBusy(button, async () => {
        await deleteBucket(workspace, bucket);
      }).catch((error) => {
        writeOutput("ERROR", "DELETE BUCKET", String(error?.message || error));
      });
    });
  }

  for (const button of bucketsTableEl.querySelectorAll(".btnSetBucketEnabledInline")) {
    button.addEventListener("click", () => {
      const workspace = button.getAttribute("data-workspace") || "";
      const bucket = button.getAttribute("data-bucket") || "";
      const enabled = button.getAttribute("data-enabled") === "true";

      setBucketNameInputFromWorkspace(workspace);
      void withBusy(button, async () => {
        await setBucketEnabled(enabled, workspace);
        writeOutput("INFO", enabled ? "ENABLED" : "DISABLED", { workspaceName: workspace, bucket });
      }).catch((error) => {
        writeOutput("ERROR", enabled ? "ENABLE BUCKET" : "DISABLE BUCKET", String(error?.message || error));
      });
    });
  }
}

async function loadBuckets() {
  const data = await apiRequest({ method: "GET", path: "/api/admin/buckets", writeOutput });
  state.buckets = Array.isArray(data?.workspaces) ? data.workspaces : [];
  renderBuckets();
}

async function bucketInfo() {
  const workspaceName = toWorkspaceName(byId("bucketName").value);
  if (!workspaceName) {
    writeOutput("WARN", "BUCKET INFO", "Store ID is required.");
    return;
  }

  const data = await apiRequest({
    method: "GET",
    path: "/api/admin/buckets/" + encodeURIComponent(workspaceName),
    writeOutput,
  });

  bucketInfoRawEl.textContent = JSON.stringify(data, null, 2);
}

async function upsertBucket() {
  const workspaceName = toWorkspaceName(byId("bucketName").value);
  const password = byId("bucketPassword").value.trim();
  const quotaMb = Number(byId("bucketQuotaMb").value.trim());

  if (!workspaceName) {
    writeOutput("WARN", "UPSERT BUCKET", "Store ID is required.");
    return;
  }

  await apiRequest({
    method: "POST",
    path: "/api/admin/buckets/" + encodeURIComponent(workspaceName) + "/upsert",
    body: {
      password,
      quotaMb: Number.isFinite(quotaMb) ? quotaMb : undefined,
    },
    writeOutput,
  });

  await loadBuckets();
  await bucketInfo();
}

async function setBucketEnabled(enabled, workspaceNameOverride = "") {
  const workspaceName = toWorkspaceName(workspaceNameOverride || byId("bucketName").value);
  if (!workspaceName) {
    writeOutput("WARN", "BUCKET ENABLE", "Store ID is required.");
    return;
  }

  await apiRequest({
    method: "POST",
    path: "/api/admin/buckets/" + encodeURIComponent(workspaceName) + "/enabled",
    body: { enabled },
    writeOutput,
  });

  await loadBuckets();
  await bucketInfo();
}

async function deleteBucket(workspaceName, bucketLabel = "") {
  const normalizedWorkspaceName = toWorkspaceName(workspaceName);
  if (!normalizedWorkspaceName) {
    writeOutput("WARN", "DELETE BUCKET", "Store ID is required.");
    return;
  }

  await apiRequest({
    method: "DELETE",
    path: "/api/admin/buckets/" + encodeURIComponent(normalizedWorkspaceName),
    writeOutput,
  });

  if (bucketLabel) {
    writeOutput("INFO", "DELETED", { workspaceName: normalizedWorkspaceName, bucket: bucketLabel });
  }

  bucketInfoRawEl.textContent = "";
  await loadBuckets();
}

byId("btnBuckets").addEventListener("click", () => {
  void withBusy(byId("btnBuckets"), loadBuckets).catch((error) => {
    writeOutput("ERROR", "BUCKETS", String(error?.message || error));
  });
});

byId("btnUpsertBucket").addEventListener("click", () => {
  void withBusy(byId("btnUpsertBucket"), upsertBucket).catch((error) => {
    writeOutput("ERROR", "UPSERT", String(error?.message || error));
  });
});

byId("btnBucketInfo").addEventListener("click", () => {
  void withBusy(byId("btnBucketInfo"), bucketInfo).catch((error) => {
    writeOutput("ERROR", "INFO", String(error?.message || error));
  });
});

byId("btnEnableBucket").addEventListener("click", () => {
  void withBusy(byId("btnEnableBucket"), async () => setBucketEnabled(true)).catch((error) => {
    writeOutput("ERROR", "ENABLE", String(error?.message || error));
  });
});

byId("btnDisableBucket").addEventListener("click", () => {
  void withBusy(byId("btnDisableBucket"), async () => setBucketEnabled(false)).catch((error) => {
    writeOutput("ERROR", "DISABLE", String(error?.message || error));
  });
});

byId("btnDeleteBucketForm").addEventListener("click", () => {
  void withBusy(byId("btnDeleteBucketForm"), async () => {
    const workspaceName = byId("bucketName").value;
    await deleteBucket(workspaceName);
  }).catch((error) => {
    writeOutput("ERROR", "DELETE", String(error?.message || error));
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

writeOutput("INFO", "READY", "Buckets page loaded");
void loadBuckets();
