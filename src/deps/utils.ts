import { randomBytes } from "node:crypto";
import { MinioWorkspaceError } from "../error";

export function shQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function normalizePart(input: string) {
  const value = input.trim().replaceAll("\\", "/");
  return value.replace(/^\/+|\/+$/g, "");
}

export function joinKey(...parts: string[]) {
  const out: string[] = [];
  for (const part of parts) {
    const normalized = normalizePart(part);
    if (normalized) out.push(normalized);
  }
  return out.join("/");
}

export function assertNamespace(namespace: string) {
  const normalized = normalizePart(namespace);
  if (!normalized) {
    throw new MinioWorkspaceError({ status: 400, code: "namespace_required" });
  }

  if (normalized.split("/").some((value) => value === "." || value === ".." || value.trim() === "")) {
    throw new MinioWorkspaceError({ status: 400, code: "invalid_namespace" });
  }

  return normalized;
}

export function slugifyBucketId(input: string) {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "default";
}

export function dateNowMs() {
  return Date.now();
}

export function generateRandomHex(length: number = 16) {
  return randomBytes(length).toString("hex");
}

/**
 * Runs `task` over `items` with at most `limit` in flight, keeping the order of
 * the results. Every task here spawns an `mc` process, so the limit is what
 * stops a server with a hundred buckets from forking a hundred clients at once.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await task(items[index]);
    }
  };

  const size = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: size }, () => worker()));

  return out;
}
