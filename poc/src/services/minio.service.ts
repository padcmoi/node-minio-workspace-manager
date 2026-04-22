import { MinioWorkspaceError, MinioWorkspaceService, type UploadedFile } from "@naskot/node-minio-workspace-manager";
import { execFile as execFileCallback } from "node:child_process";
import util from "node:util";

const endpoint = process.env.MINIO_ENDPOINT ?? "http://minio:9000";
const containerName = process.env.MINIO_CONTAINER_NAME ?? "ast_minio_poc";
const rootUser = process.env.MINIO_ROOT_USER ?? "admin";
const rootPassword = process.env.MINIO_ROOT_PASSWORD ?? "ChangeThisPassword123!";
const alias = process.env.MINIO_ALIAS ?? "ast-minio-poc";
const execFileAsync = util.promisify(execFileCallback);

export const minio = new MinioWorkspaceService({
  endpoint,
  containerName,
  rootUser,
  rootPassword,
  alias,
  runtime: {
    enabled: true,
    logger: {
      info: (message, meta) => console.info(message, meta ?? ""),
      warn: (message, meta) => console.warn(message, meta ?? ""),
      error: (message, meta) => console.error(message, meta ?? ""),
    },
  },
});

export const minioAdminService = minio.minioAdminService;

export function minioBucketService(storeId: string) {
  return minio.minioBucketService(storeId);
}

function normalizeTreePrefix(value: string) {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function parseMcTreeLines(stdout: string) {
  const objects: {
    key: string;
    size: number;
    lastModified: string | null;
    etag: string | null;
  }[] = [];

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;

    const keyRaw = Reflect.get(parsed, "key");
    const sizeRaw = Reflect.get(parsed, "size");
    const etagRaw = Reflect.get(parsed, "etag");
    const lastModifiedRaw = Reflect.get(parsed, "lastModified");

    const key = typeof keyRaw === "string" ? normalizeTreePrefix(keyRaw) : "";
    const size = typeof sizeRaw === "number" ? sizeRaw : null;
    const etag = typeof etagRaw === "string" ? etagRaw : null;
    const lastModified = typeof lastModifiedRaw === "string" ? lastModifiedRaw : null;

    if (!key || size === null) continue;

    objects.push({
      key,
      size,
      etag,
      lastModified,
    });
  }

  return objects;
}

function buildTreeAlias(storeId: string) {
  const safe = storeId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return `poc-tree-${safe || "store"}`.slice(0, 60);
}

export async function listStoreTree(storeId: string, prefix: string = "") {
  const store = await minio.getStore(storeId);
  const treeAlias = buildTreeAlias(storeId);
  const safePrefix = normalizeTreePrefix(prefix);
  const target = safePrefix ? `${treeAlias}/${store.bucket}/${safePrefix}` : `${treeAlias}/${store.bucket}`;

  try {
    await execFileAsync("mc", ["alias", "set", treeAlias, endpoint, rootUser, rootPassword], {
      env: {
        ...process.env,
        MC_CONFIG_DIR: "/tmp/mc",
        HOME: "/tmp",
      },
    });

    const { stdout } = await execFileAsync("mc", ["ls", "--json", "--recursive", target], {
      env: {
        ...process.env,
        MC_CONFIG_DIR: "/tmp/mc",
        HOME: "/tmp",
      },
      maxBuffer: 20 * 1024 * 1024,
    });

    const objects = parseMcTreeLines(stdout);

    return {
      bucket: store.bucket,
      count: objects.length,
      objects,
    };
  } catch {
    throw createMinioWorkspaceError({
      status: 500,
      code: "tree_list_failed",
      details: {
        storeId,
        prefix: safePrefix,
      },
    });
  }
}

export function createMinioWorkspaceError(options: { status?: number; code?: string; message?: string; details?: unknown }) {
  return new MinioWorkspaceError(options);
}

export function toMinioErrorPayload(error: unknown) {
  if (!(error instanceof MinioWorkspaceError)) return null;

  return {
    status: error.status ?? 500,
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  };
}

export type { UploadedFile };
