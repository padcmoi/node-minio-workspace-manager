import {
  apiRequest,
  buildStorageApiPath,
  byId,
  createOutputWriter,
  normalizePrefix,
  parseJsonArray,
  parseResponsePayload,
  readValue,
  sharedPageShell,
  withBusy,
} from "/public/js/common.js";

function readBucketPageContext() {
  const contextEl = document.getElementById("bucket-page-context");
  if (!contextEl) {
    throw new Error("Missing backend bucket page context.");
  }

  const rawText = contextEl.textContent ?? "";
  let raw = null;

  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid backend bucket page context payload.");
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid backend bucket page context.");
  }

  const storeId = typeof raw.storeId === "string" ? raw.storeId : "";
  const workspaceName = typeof raw.workspaceName === "string" ? raw.workspaceName : "";
  const bucketLabel = typeof raw.bucketLabel === "string" ? raw.bucketLabel : "";

  if (!storeId || !workspaceName || !bucketLabel) {
    throw new Error("Invalid backend bucket page context.");
  }

  return {
    storeId,
    workspaceName,
    bucketLabel,
  };
}

function splitBucketPath(value) {
  const normalized = normalizePrefix(value);
  if (!normalized) {
    return {
      full: "",
      namespace: "",
      relative: "",
      leaf: "",
    };
  }

  const parts = normalized.split("/").filter(Boolean);
  const namespace = parts[0] || "";
  const relativeParts = parts.slice(1);

  return {
    full: normalized,
    namespace,
    relative: relativeParts.join("/"),
    leaf: parts[parts.length - 1] || "",
  };
}

function joinBucketPath(left, right) {
  const a = normalizePrefix(left);
  const b = normalizePrefix(right);

  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

const pageContext = readBucketPageContext();
const { storeId, workspaceName, bucketLabel } = pageContext;

sharedPageShell({
  title: "POC MinIO Workspace Manager",
  subtitle: `Bucket workspace route for storeId: ${storeId}`,
  activeNav: "bucket",
  bucketNavHref: window.location.pathname,
  bucketNavLabel: bucketLabel,
});

const outputEl = byId("output");
const writeOutput = createOutputWriter(outputEl);
const bucketInfoRawEl = byId("bucketInfoRaw");
const treePanelEl = byId("treePanel");

const state = {
  storeId,
  workspaceName,
  bucketLabel,
  currentPrefix: "",
  bucketObjects: [],
  expandedFolders: new Set(),
};

byId("bucketViewTitle").textContent = `Bucket workspace: ${bucketLabel}`;
byId("selectedBucketBadge").textContent = `Selected: ${bucketLabel}`;

function getValidObjectKey(object) {
  const key = normalizePrefix(typeof object?.key === "string" ? object.key : "");
  return key || "";
}

function buildTree(objects) {
  const root = { folders: new Map(), files: [] };

  for (const obj of objects) {
    const fullKey = getValidObjectKey(obj);
    if (!fullKey) continue;

    const parts = fullKey.split("/").filter(Boolean);
    if (!parts.length) continue;

    let cursor = root;

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        cursor.files.push({
          name: part,
          fullKey,
          size: obj.size,
        });
        continue;
      }

      if (!cursor.folders.has(part)) {
        cursor.folders.set(part, {
          folders: new Map(),
          files: [],
        });
      }

      cursor = cursor.folders.get(part);
    }
  }

  return root;
}

function renderTreeBranch(node, parentPrefix, depth = 0) {
  const list = document.createElement("ul");
  list.className = depth === 0 ? "space-y-4 pl-4" : "space-y-1 pl-4";

  const folderNames = Array.from(node.folders.keys()).sort((a, b) => a.localeCompare(b));

  for (const folderName of folderNames) {
    const nextPrefix = parentPrefix ? `${parentPrefix}/${folderName}` : folderName;
    const child = node.folders.get(folderName);

    const item = document.createElement("li");
    item.className = "";

    const details = document.createElement("details");
    details.dataset.loaded = "false";
    details.dataset.loading = "false";
    details.className = "";

    const summary = document.createElement("summary");
    summary.className = "list-item cursor-pointer py-0.5 text-[13px] font-semibold leading-6 text-slate-200";
    summary.textContent = folderName;
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "mt-0 ml-1 space-y-1";
    details.appendChild(body);

    const mountChildren = (showLoader) => {
      if (details.dataset.loaded === "true") return;
      if (details.dataset.loading === "true") return;
      details.dataset.loading = "true";
      body.innerHTML = "";

      const renderLoadedTree = () => {
        if (!details.open) {
          body.innerHTML = "";
          details.dataset.loading = "false";
          return;
        }

        const childTree = renderTreeBranch(child, nextPrefix, depth + 1);
        body.innerHTML = "";
        body.appendChild(childTree);
        details.dataset.loaded = "true";
        details.dataset.loading = "false";
      };

      if (!showLoader) {
        renderLoadedTree();
        return;
      }

      const loader = document.createElement("div");
      loader.className = "px-1 py-0.5 text-[11px] text-slate-400";
      loader.textContent = "...";
      body.appendChild(loader);

      window.setTimeout(renderLoadedTree, 140);
    };

    details.addEventListener("toggle", () => {
      if (details.open) {
        state.expandedFolders.add(nextPrefix);
        state.currentPrefix = nextPrefix;
        syncInputsFromCurrentPrefix();
        mountChildren(true);
        return;
      }

      state.expandedFolders.delete(nextPrefix);
    });

    const initiallyOpen = state.expandedFolders.has(nextPrefix);
    if (initiallyOpen) {
      details.open = true;
      mountChildren(false);
    }

    item.appendChild(details);
    list.appendChild(item);
  }

  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    const fileItem = document.createElement("li");
    fileItem.className = "px-2 py-1 text-[11px] text-slate-300";

    const line = document.createElement("div");
    line.className = "flex items-center justify-between gap-3";

    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = `${fileIconFromName(file.name)} ${file.name} (${String(file.size ?? 0)} bytes)`;

    const actions = document.createElement("div");
    actions.className = "flex items-center justify-end gap-1";

    const ns = splitKeyForNamespace(file.fullKey);

    if (ns) {
      const viewHref = buildStorageApiPath(state.storeId, ns.namespace, `/view?key=${encodeURIComponent(ns.fullKey)}`);
      const downHref = buildStorageApiPath(state.storeId, ns.namespace, `/file?key=${encodeURIComponent(ns.fullKey)}`);

      const view = document.createElement("a");
      view.href = viewHref;
      view.target = "_blank";
      view.rel = "noopener noreferrer";
      view.title = "View";
      view.ariaLabel = "View";
      view.className = "rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500";
      view.textContent = "🔍";

      const down = document.createElement("a");
      down.href = downHref;
      down.title = "Download";
      down.ariaLabel = "Download";
      down.className = "rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-500";
      down.textContent = "⬇";

      const del = document.createElement("button");
      del.type = "button";
      del.title = "Delete";
      del.ariaLabel = "Delete";
      del.className = "rounded bg-rose-700 px-2 py-1 text-white hover:bg-rose-600";
      del.textContent = "🗑";
      del.addEventListener("click", () => {
        void deleteOneFile(file.fullKey);
      });

      actions.append(view, down, del);
    }

    line.append(label, actions);
    fileItem.appendChild(line);
    list.appendChild(fileItem);
  }

  return list;
}

function syncInputsFromCurrentPrefix() {
  const path = splitBucketPath(state.currentPrefix);

  if (path.namespace) {
    byId("namespace").value = path.namespace;
  }

  byId("prefix").value = path.relative;
}

function splitKeyForNamespace(fullKey) {
  const path = splitBucketPath(fullKey);
  const namespace = path.namespace;

  if (!namespace) return null;

  return {
    namespace,
    fullKey: path.full,
  };
}

function fileIconFromName(fileName) {
  const lower = String(fileName || "").toLowerCase();

  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(lower)) return "🖼️";
  if (/\.pdf$/.test(lower)) return "📕";
  if (/\.(doc|docx|odt|rtf)$/.test(lower)) return "📝";
  if (/\.(xls|xlsx|csv|ods)$/.test(lower)) return "📊";
  if (/\.(ppt|pptx|odp)$/.test(lower)) return "📽️";
  if (/\.(zip|rar|7z|tar|gz)$/.test(lower)) return "🗜️";
  if (/\.(mp3|wav|ogg|flac|m4a)$/.test(lower)) return "🎵";
  if (/\.(mp4|webm|mov|avi|mkv)$/.test(lower)) return "🎬";
  if (/\.(txt|md|log|json|xml|yaml|yml|ini)$/.test(lower)) return "📄";
  return "📎";
}

function renderBucketBrowser() {
  const previousScrollTop = treePanelEl.scrollTop;
  const tree = buildTree(state.bucketObjects);
  treePanelEl.innerHTML = "";
  treePanelEl.appendChild(renderTreeBranch(tree, "", 0));
  treePanelEl.scrollTop = previousScrollTop;
}

async function bucketInfo() {
  const data = await apiRequest({
    method: "GET",
    path: "/api/admin/buckets/" + encodeURIComponent(state.workspaceName),
    writeOutput,
  });

  bucketInfoRawEl.textContent = JSON.stringify(data, null, 2);
}

async function loadBucketTree() {
  const path = `/api/storage/${encodeURIComponent(state.storeId)}/tree`;
  try {
    const data = await apiRequest({ method: "GET", path, writeOutput });
    state.bucketObjects = Array.isArray(data?.objects) ? data.objects : [];
  } catch (error) {
    state.bucketObjects = [];
    renderBucketBrowser();
    throw error;
  }

  renderBucketBrowser();
}

function openPrefix(prefix) {
  state.currentPrefix = normalizePrefix(prefix);
  syncInputsFromCurrentPrefix();
  renderBucketBrowser();
}

function resolveUploadTarget() {
  const namespaceInput = normalizePrefix(readValue("namespace"));
  const prefixInput = normalizePrefix(readValue("prefix"));
  const current = splitBucketPath(state.currentPrefix);

  // Explicit form namespace always wins over tree context.
  let fullTarget = namespaceInput ? joinBucketPath(namespaceInput, prefixInput) : current.full;

  if (!namespaceInput && prefixInput) {
    fullTarget = joinBucketPath(fullTarget, prefixInput);
  }

  const target = splitBucketPath(fullTarget);
  if (!target.namespace) {
    throw new Error("Namespace is required for upload. Select a folder or set namespace.");
  }

  return target;
}

async function uploadFiles() {
  const input = byId("files");
  const files = Array.from(input.files || []);

  if (!files.length) {
    writeOutput("WARN", "UPLOAD", "No file selected");
    return;
  }

  const target = resolveUploadTarget();
  const form = new FormData();

  for (const file of files) {
    form.append("files", file, file.name);
  }

  const refs = parseJsonArray(readValue("refs"), []);
  if (refs.length > 0 && refs.length !== files.length) {
    writeOutput(
      "WARN",
      "UPLOAD",
      `Ignoring refs: expected ${files.length} item(s), got ${refs.length}. Upload continues with auto refs.`
    );
  } else if (refs.length) {
    form.append("refs", JSON.stringify(refs));
  }

  if (target.relative) {
    form.append("prefix", target.relative);
  }

  const path = buildStorageApiPath(state.storeId, target.namespace, "/files");
  const response = await fetch(path, { method: "POST", body: form });
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    writeOutput("ERROR", `POST ${path}`, payload);
    throw new Error("Upload failed");
  }

  writeOutput("OK", `POST ${path}`, payload);

  state.currentPrefix = target.full;
  syncInputsFromCurrentPrefix();
  await loadBucketTree();
}

async function deleteOneFile(fullKey) {
  const split = splitKeyForNamespace(fullKey);
  if (!split) {
    writeOutput("ERROR", "DELETE", `Invalid file key: ${fullKey}`);
    return;
  }

  const path = buildStorageApiPath(state.storeId, split.namespace, "/files");

  await apiRequest({
    method: "DELETE",
    path,
    body: { keys: [split.fullKey] },
    writeOutput,
  });

  await loadBucketTree();
}

byId("btnBucketViewRefresh").addEventListener("click", () => {
  void withBusy(byId("btnBucketViewRefresh"), async () => {
    await bucketInfo();
    await loadBucketTree();
  }).catch((error) => {
    writeOutput("ERROR", "REFRESH", String(error?.message || error));
  });
});

byId("btnUpload").addEventListener("click", () => {
  void withBusy(byId("btnUpload"), uploadFiles).catch((error) => {
    writeOutput("ERROR", "UPLOAD", String(error?.message || error));
  });
});

byId("btnListFiles").addEventListener("click", () => {
  void withBusy(byId("btnListFiles"), loadBucketTree).catch((error) => {
    writeOutput("ERROR", "LIST", String(error?.message || error));
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

writeOutput("INFO", "READY", "Bucket page loaded");
void bucketInfo();
void loadBucketTree();
