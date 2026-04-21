# NestJS Usage

Compatibility target: `minio/minio:RELEASE.2025-04-22T22-12-26Z` (future versions are not supported because MinIO removed the communication mechanism used by this library; older versions are not guaranteed).

All runtime access should go through one service.

Service (`minio.service.ts`)

```ts
import { Injectable } from "@nestjs/common";
import { MinioWorkspaceError, MinioWorkspaceService } from "@naskot/node-minio-workspace-manager";

@Injectable()
export class MinioService {
  private readonly manager = new MinioWorkspaceService({
    endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
    containerName: process.env.MINIO_CONTAINER_NAME ?? "ast_minio",
    rootUser: process.env.MINIO_ROOT_USER ?? "admin",
    rootPassword: process.env.MINIO_ROOT_PASSWORD ?? "ChangeThisPassword123!",
    alias: process.env.MINIO_ALIAS ?? "ast-minio",
  });

  readonly minioAdminService = this.manager.minioAdminService;

  minioBucketService(storeId: string) {
    return this.manager.minioBucketService(storeId);
  }

  toErrorPayload(error: unknown) {
    if (!(error instanceof MinioWorkspaceError)) return null;

    return {
      status: error.status ?? 500,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    };
  }
}
```

Sample: bucket operations

```ts
import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { MinioService } from "../services/minio.service";

@Controller("admin")
export class MinioAdminApi {
  constructor(private readonly minio: MinioService) {}

  @Post("buckets/:name/upsert")
  upsertBucket(@Param("name") name: string, @Body() body: { password?: string; quotaMb?: number }) {
    return this.minio.minioAdminService.upsertBucket(name, body);
  }

  @Get("buckets")
  listBuckets() {
    return this.minio.minioAdminService.listBuckets();
  }

  @Get("buckets/:name")
  bucketInfo(@Param("name") name: string) {
    return this.minio.minioAdminService.getBucketInfo(name);
  }

  @Post("buckets/:name/enabled")
  setBucketEnabled(@Param("name") name: string, @Body() body: { enabled: boolean }) {
    return this.minio.minioAdminService.setBucketEnabled(name, !!body.enabled);
  }

  @Delete("buckets/:name")
  deleteBucket(@Param("name") name: string) {
    return this.minio.minioAdminService.deleteBucket(name);
  }

  @Get("metrics")
  metrics() {
    return this.minio.minioAdminService.getMinioMetrics();
  }
}
```

Sample: upload, list, delete files

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFiles, UseInterceptors } from "@nestjs/common";
import type { UploadedFile } from "@naskot/node-minio-workspace-manager";
import { FilesInterceptor } from "@nestjs/platform-express";
import multer from "multer";
import { MinioService } from "../services/minio.service";

@Controller("storage")
export class MinioStorageApi {
  constructor(private readonly minio: MinioService) {}

  @Post(":storeId/:namespace/files")
  @UseInterceptors(FilesInterceptor("files", 50, { storage: multer.memoryStorage() }))
  async uploadFiles(
    @Param("storeId") storeId: string,
    @Param("namespace") namespace: string,
    @UploadedFiles() filesRaw: Express.Multer.File[],
    @Body() body: { prefix?: string; refs?: string[] }
  ) {
    const bucket = await this.minio.minioBucketService(storeId);

    const files = (filesRaw ?? []).map((file) => {
      return {
        originalname: file.originalname,
        buffer: file.buffer,
        size: file.size,
      } satisfies UploadedFile;
    });

    const refs = Array.isArray(body.refs) ? body.refs : [];
    return bucket.uploadMany(namespace, files, body.prefix ?? "", refs);
  }

  @Get(":storeId/:namespace/files")
  async listFiles(@Param("storeId") storeId: string, @Param("namespace") namespace: string, @Query("prefix") prefix?: string) {
    const bucket = await this.minio.minioBucketService(storeId);
    return bucket.listObjects(namespace, prefix ?? "");
  }

  @Delete(":storeId/:namespace/files")
  async deleteFiles(@Param("storeId") storeId: string, @Param("namespace") namespace: string, @Body() body: { keys: string[] }) {
    const bucket = await this.minio.minioBucketService(storeId);
    return bucket.deleteObjects(namespace, Array.isArray(body.keys) ? body.keys : []);
  }
}
```

Sample: download and inline view

```ts
import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import path from "node:path";
import { MinioService } from "../services/minio.service";

@Controller("storage")
export class MinioReadApi {
  constructor(private readonly minio: MinioService) {}

  @Get(":storeId/:namespace/file")
  async downloadFile(
    @Param("storeId") storeId: string,
    @Param("namespace") namespace: string,
    @Query("key") key: string,
    @Res() res: Response
  ) {
    const bucket = await this.minio.minioBucketService(storeId);
    const buffer = await bucket.downloadObjectBuffer(namespace, key);
    const filename = path.posix.basename(key) || "file.bin";

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  }

  @Get(":storeId/:namespace/view")
  async viewFile(
    @Param("storeId") storeId: string,
    @Param("namespace") namespace: string,
    @Query("key") key: string,
    @Res() res: Response
  ) {
    const bucket = await this.minio.minioBucketService(storeId);
    const buffer = await bucket.downloadObjectBuffer(namespace, key);
    const filename = path.posix.basename(key) || "file.bin";

    res.setHeader("Content-Type", bucket.guessMimeTypeFromKey(filename));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${filename.replaceAll('"', "")}"`);
    res.send(buffer);
  }
}
```

Sample: central error mapping

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { MinioService } from "../services/minio.service";

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly minio: MinioService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const libError = this.minio.toErrorPayload(exception);

    if (libError) {
      response.status(libError.status).json({
        ok: false,
        code: libError.code,
        message: libError.message,
        details: libError.details,
      });
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, code: "INTERNAL_ERROR" });
  }
}
```

What you can do

- Bucket management: create/update, list, info, enable/disable user access, delete, metrics.
- File management: upload (single/multi), list, delete, download, inline view.
- Namespace and folders: `namespace` is required; `prefix` creates virtual subfolders in keys.

Options and limits

- `upsertBucket(name, { password?, quotaMb? })`
- `quotaMb` default is `500` MB if omitted.
- `password` is required when creating a new bucket user.
- Upload sample uses `FilesInterceptor("files", 50, ...)` -> max 50 files/request at interceptor level.
- `refs` should match file count when used.
- Default store mapping: `storeId=demo` maps to bucket `bucket-store-demo`.
