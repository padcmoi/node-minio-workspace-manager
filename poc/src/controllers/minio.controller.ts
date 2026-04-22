import type { Request } from "express";
import path from "node:path";
import {
  createMinioWorkspaceError,
  listStoreTree,
  minioAdminService,
  minioBucketService,
  type UploadedFile,
} from "../services/minio.service";

function pickParam(req: Request, key: string) {
  const value = req.params[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function pickRefs(body: unknown) {
  if (typeof body !== "object" || body === null) return [];
  const refsRaw = (body as Record<string, unknown>).refs;

  if (Array.isArray(refsRaw)) {
    return refsRaw.filter((value): value is string => typeof value === "string");
  }

  if (typeof refsRaw === "string") {
    try {
      const parsed: unknown = JSON.parse(refsRaw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      // ignore json parse error
    }
    return refsRaw ? [refsRaw] : [];
  }

  return [];
}

function pickPrefix(body: unknown) {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>).prefix;
  if (typeof value !== "string") return "";
  return value;
}

function toUploadedFiles(req: Request) {
  const files = (req.files ?? []) as Express.Multer.File[];
  return files.map((file) => {
    return {
      originalname: file.originalname,
      buffer: file.buffer,
      size: file.size,
    } satisfies UploadedFile;
  });
}

export async function upsertBucketController(req: Request) {
  const name = pickParam(req, "name");
  const body = req.body as { password?: string; quotaMb?: number } | undefined;

  return minioAdminService.upsertBucket(name, {
    password: body?.password,
    quotaMb: body?.quotaMb,
  });
}

export async function deleteBucketController(req: Request) {
  return minioAdminService.deleteBucket(pickParam(req, "name"));
}

export async function listBucketsController() {
  return minioAdminService.listBuckets();
}

export async function bucketInfoController(req: Request) {
  return minioAdminService.getBucketInfo(pickParam(req, "name"));
}

export async function setBucketEnabledController(req: Request) {
  const enabled = !!(req.body as { enabled?: boolean } | undefined)?.enabled;
  return minioAdminService.setBucketEnabled(pickParam(req, "name"), enabled);
}

export async function minioMetricsController() {
  return minioAdminService.getMinioMetrics();
}

export async function uploadFilesController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const namespace = pickParam(req, "namespace");
  const bucket = await minioBucketService(storeId);

  const files = toUploadedFiles(req);
  const refs = pickRefs(req.body);
  const prefix = pickPrefix(req.body);

  if (files.length === 0) {
    throw createMinioWorkspaceError({ status: 400, code: "files_missing" });
  }

  if (refs.length > 0 && refs.length !== files.length) {
    throw createMinioWorkspaceError({
      status: 400,
      code: "refs_files_mismatch",
      details: {
        refsCount: refs.length,
        filesCount: files.length,
      },
    });
  }

  const safeRefs = refs.length === files.length ? refs : files.map((_file, index) => `file-${index + 1}`);
  const result = await bucket.uploadMany(namespace, files, prefix, safeRefs);

  // POC note:
  // This mapping is the exact place where application code can persist
  // document tracking data into a database (original file name <-> MinIO generated path/id).
  const trackingForDb = result.uploaded.map((uploaded, index) => {
    const originalName = files[index]?.originalname ?? null;
    const minioFullPath = uploaded.key;
    const generatedName = minioFullPath.split("/").pop() ?? minioFullPath;
    const extensionIndex = generatedName.lastIndexOf(".");
    const generatedHashLikeId = extensionIndex > 0 ? generatedName.slice(0, extensionIndex) : generatedName;

    return {
      originalName,
      minioFullPath, // namespace/folders + generated file name
      generatedName, // generatedName.ext
      generatedHashLikeId, // generated file id (hash-like)
      ref: uploaded.ref,
      size: uploaded.size,
    };
  });

  console.info(
    "[POC][UPLOAD_TRACKING] Here you can track MinIO S3 saved file path (namespace/folders/generated hash-like file name) versus the original uploaded file name for theoretical DB persistence.",
    trackingForDb
  );

  return result;
}

export async function listFilesController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const namespace = pickParam(req, "namespace");
  const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
  const bucket = await minioBucketService(storeId);

  return bucket.listObjects(namespace, prefix);
}

export async function listBucketTreeController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
  return listStoreTree(storeId, prefix);
}

export async function deleteFilesController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const namespace = pickParam(req, "namespace");
  const keys = ((req.body as { keys?: unknown } | undefined)?.keys ?? []) as unknown[];
  const safeKeys = keys.filter((value): value is string => typeof value === "string");

  if (!safeKeys.length) {
    throw createMinioWorkspaceError({ status: 400, code: "invalid_keys" });
  }

  const bucket = await minioBucketService(storeId);
  return bucket.deleteObjects(namespace, safeKeys);
}

export async function downloadFileController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const namespace = pickParam(req, "namespace");
  const key = typeof req.query.key === "string" ? req.query.key : "";

  if (!key) {
    throw createMinioWorkspaceError({ status: 400, code: "key_required" });
  }

  const bucket = await minioBucketService(storeId);
  const buffer = await bucket.downloadObjectBuffer(namespace, key);
  const filename = path.posix.basename(key) || "file.bin";

  return {
    filename,
    contentType: "application/octet-stream",
    buffer,
    disposition: "attachment",
  };
}

export async function viewFileController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const namespace = pickParam(req, "namespace");
  const key = typeof req.query.key === "string" ? req.query.key : "";

  if (!key) {
    throw createMinioWorkspaceError({ status: 400, code: "key_required" });
  }

  const bucket = await minioBucketService(storeId);
  const buffer = await bucket.downloadObjectBuffer(namespace, key);
  const filename = path.posix.basename(key) || "file.bin";

  return {
    filename,
    contentType: bucket.guessMimeTypeFromKey(filename),
    buffer,
    disposition: "inline",
  };
}

export function bucketPageContextController(req: Request) {
  const storeId = pickParam(req, "storeId");
  const workspaceName = `store-${storeId}`;
  const bucketLabel = `bucket-${workspaceName}`;

  return {
    storeId,
    workspaceName,
    bucketLabel,
  };
}
