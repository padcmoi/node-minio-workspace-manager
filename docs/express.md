# Express Usage

Compatibility target: `minio/minio:RELEASE.2025-04-22T22-12-26Z` (future versions are not supported because MinIO removed the communication mechanism used by this library; older versions are not guaranteed).

All runtime access should go through one service.

Service (`minio.service.ts`)

```ts
import { MinioWorkspaceError, MinioWorkspaceService } from "@naskot/node-minio-workspace-manager";

const manager = new MinioWorkspaceService({
  endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
  containerName: process.env.MINIO_CONTAINER_NAME ?? "ast_minio",
  rootUser: process.env.MINIO_ROOT_USER ?? "admin",
  rootPassword: process.env.MINIO_ROOT_PASSWORD ?? "ChangeThisPassword123!",
  alias: process.env.MINIO_ALIAS ?? "ast-minio",
});

export const minioAdminService = manager.minioAdminService;

export function minioBucketService(storeId: string) {
  return manager.minioBucketService(storeId);
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
```

Sample: create or update a bucket

```ts
import type { Request, Response, NextFunction } from "express";
import { minioAdminService } from "../services/minio.service";

export async function upsertBucket(req: Request, res: Response, next: NextFunction) {
  try {
    const out = await minioAdminService.upsertBucket(req.params.name, {
      password: req.body.password,
      quotaMb: req.body.quotaMb,
    });
    res.json(out);
  } catch (error) {
    next(error);
  }
}
```

Sample: read admin info (list, details, enable/disable, delete, metrics)

```ts
import type { Request, Response, NextFunction } from "express";
import { minioAdminService } from "../services/minio.service";

export const listBuckets = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await minioAdminService.listBuckets());
  } catch (error) {
    next(error);
  }
};

export const bucketInfo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await minioAdminService.getBucketInfo(req.params.name));
  } catch (error) {
    next(error);
  }
};

export const setBucketEnabled = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await minioAdminService.setBucketEnabled(req.params.name, !!req.body.enabled));
  } catch (error) {
    next(error);
  }
};

export const deleteBucket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await minioAdminService.deleteBucket(req.params.name));
  } catch (error) {
    next(error);
  }
};

export const minioMetrics = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await minioAdminService.getMinioMetrics());
  } catch (error) {
    next(error);
  }
};
```

Sample: upload files

```ts
import type { Request, Response, NextFunction } from "express";
import type { UploadedFile } from "@naskot/node-minio-workspace-manager";
import { minioBucketService } from "../services/minio.service";

export async function uploadFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const bucket = await minioBucketService(req.params.storeId);

    const files = ((req.files ?? []) as Express.Multer.File[]).map((file) => {
      return {
        originalname: file.originalname,
        buffer: file.buffer,
        size: file.size,
      } satisfies UploadedFile;
    });

    const refs = Array.isArray(req.body.refs) ? req.body.refs : [];
    const prefix = typeof req.body.prefix === "string" ? req.body.prefix : "";

    res.json(await bucket.uploadMany(req.params.namespace, files, prefix, refs));
  } catch (error) {
    next(error);
  }
}
```

Sample: list and delete files

```ts
import type { Request, Response, NextFunction } from "express";
import { minioBucketService } from "../services/minio.service";

export async function listFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const bucket = await minioBucketService(req.params.storeId);
    const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
    res.json(await bucket.listObjects(req.params.namespace, prefix));
  } catch (error) {
    next(error);
  }
}

export async function deleteFiles(req: Request, res: Response, next: NextFunction) {
  try {
    const bucket = await minioBucketService(req.params.storeId);
    const keys = Array.isArray(req.body.keys) ? req.body.keys : [];
    res.json(await bucket.deleteObjects(req.params.namespace, keys));
  } catch (error) {
    next(error);
  }
}
```

Sample: download and inline view

```ts
import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { minioBucketService } from "../services/minio.service";

export async function downloadFile(req: Request, res: Response, next: NextFunction) {
  try {
    const bucket = await minioBucketService(req.params.storeId);
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const buffer = await bucket.downloadObjectBuffer(req.params.namespace, key);
    const filename = path.posix.basename(key) || "file.bin";

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function viewFile(req: Request, res: Response, next: NextFunction) {
  try {
    const bucket = await minioBucketService(req.params.storeId);
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const buffer = await bucket.downloadObjectBuffer(req.params.namespace, key);
    const filename = path.posix.basename(key) || "file.bin";

    res.setHeader("Content-Type", bucket.guessMimeTypeFromKey(filename));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${filename.replaceAll('"', "")}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}
```

Sample: common route mapping

```ts
import express from "express";
import multer from "multer";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

app.post("/admin/buckets/:name/upsert", upsertBucket);
app.get("/admin/buckets", listBuckets);
app.get("/admin/buckets/:name", bucketInfo);
app.post("/admin/buckets/:name/enabled", setBucketEnabled);
app.delete("/admin/buckets/:name", deleteBucket);
app.get("/admin/metrics", minioMetrics);

app.post("/storage/:storeId/:namespace/files", upload.array("files", 50), uploadFiles);
app.get("/storage/:storeId/:namespace/files", listFiles);
app.delete("/storage/:storeId/:namespace/files", deleteFiles);
app.get("/storage/:storeId/:namespace/file", downloadFile);
app.get("/storage/:storeId/:namespace/view", viewFile);
```

What you can do

- Bucket management: create/update, list, info, enable/disable user access, delete, metrics.
- File management: upload (single/multi), list, delete, download, inline view.
- Namespace and folders: `namespace` is required; `prefix` creates virtual subfolders in keys.

Options and limits

- `upsertBucket(name, { password?, quotaMb? })`
- `quotaMb` default is `500` MB if omitted.
- `password` is required when creating a new bucket user.
- Upload sample uses `upload.array("files", 50)` -> max 50 files/request at middleware level.
- `refs` should match file count when used.
- Default store mapping: `storeId=demo` maps to bucket `bucket-store-demo`.
