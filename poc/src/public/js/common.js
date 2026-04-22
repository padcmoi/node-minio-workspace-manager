export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

export function readValue(id) {
  return String(byId(id).value ?? "").trim();
}

export function normalizePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function parseJsonArray(raw, fallback = []) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => typeof x === "string");
    }
  } catch {
    // ignore parse error
  }
  return fallback;
}

export function guessStoreIdFromBucket(bucket) {
  if (typeof bucket !== "string" || !bucket) return "";
  if (bucket.startsWith("bucket-store-")) return bucket.slice("bucket-store-".length);
  if (bucket.startsWith("bucket-")) return bucket.slice("bucket-".length);
  return "";
}

export function workspaceNameFromBucket(bucket) {
  if (typeof bucket !== "string" || !bucket) return "";
  if (bucket.startsWith("bucket-")) return bucket.slice("bucket-".length);
  return bucket;
}

export function isImageKey(key) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(key);
}

export function buildStorageApiPath(storeId, namespace, suffix) {
  return `/api/storage/${encodeURIComponent(storeId)}/${encodeURIComponent(namespace)}${suffix}`;
}

export async function parseResponsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest({ method, path, body, writeOutput }) {
  const options = { method, headers: {} };

  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    writeOutput?.("ERROR", `${method} ${path}`, payload);
    throw new Error(`Request failed: ${response.status}`);
  }

  writeOutput?.("OK", `${method} ${path}`, payload);
  return payload;
}

export function createOutputWriter(outputEl) {
  return (level, label, payload) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const line = `[${new Date().toISOString()}] [${level}] ${label}`;
    outputEl.textContent = `${line}\n${body}\n\n${outputEl.textContent}`;
  };
}

export async function withBusy(button, fn) {
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Running...";

  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

export function setNavActive(activeId) {
  for (const link of document.querySelectorAll("[data-nav-id]")) {
    const id = link.getAttribute("data-nav-id") || "";
    const active = id === activeId;

    link.classList.toggle("border-cyan-400", active);
    link.classList.toggle("bg-cyan-500", active);
    link.classList.toggle("text-slate-950", active);

    link.classList.toggle("border-slate-700", !active);
    link.classList.toggle("bg-slate-900", !active);
    link.classList.toggle("text-slate-200", !active);
  }
}

export function sharedPageShell({ title, subtitle, activeNav, bucketNavHref = null, bucketNavLabel = "Bucket" }) {
  const navBase = [
    {
      id: "stats",
      href: "/",
      label: "Stats",
    },
    {
      id: "buckets",
      href: "/buckets",
      label: "Buckets list",
    },
  ];

  if (bucketNavHref) {
    navBase.push({
      id: "bucket",
      href: bucketNavHref,
      label: bucketNavLabel,
    });
  }

  const navHtml = navBase
    .map((item) => {
      return `<a data-nav-id="${item.id}" href="${item.href}" class="rounded-lg border px-4 py-2 text-sm font-medium transition-colors">${item.label}</a>`;
    })
    .join("");

  const root = document.createElement("div");
  root.innerHTML = `
    <header class="mb-6 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 p-5">
      <h1 class="text-2xl font-bold md:text-3xl">${title}</h1>
      <p class="mt-2 text-sm text-slate-300">${subtitle}</p>
    </header>
    <nav class="mb-6 flex flex-wrap gap-2">${navHtml}</nav>
  `;

  const mount = byId("pageShell");
  mount.append(...root.childNodes);
  setNavActive(activeNav);
}
