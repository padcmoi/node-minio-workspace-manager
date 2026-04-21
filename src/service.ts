import { MinioWorkspaceError } from "./error";
import { MinioAdminManager } from "./minio-admin";
import { MinioBucketManager } from "./minio-bucket";
import type { MinioWorkspaceServiceOptions, S3StoreConfig } from "./types";

const DEFAULT_STORE_BUCKET_PREFIX = "bucket-store-";
const DEFAULT_STORE_SECRET_KEY = "123456789";

export class MinioWorkspaceService {
  readonly minioAdminService: MinioAdminManager;

  private readonly endpoint;
  private readonly storeBucketPrefix;
  private readonly defaultStoreSecretKey;
  private readonly workspaceHost;
  private readonly workspacePort;
  private readonly workspaceUseSSL;
  private readonly runtime;
  private readonly mapStoreIdToBucketName;
  private readonly mapWorkspaceToStoreConfig;

  constructor(options: MinioWorkspaceServiceOptions) {
    this.endpoint = options.endpoint;
    this.storeBucketPrefix = options.storeBucketPrefix ?? DEFAULT_STORE_BUCKET_PREFIX;
    this.defaultStoreSecretKey = options.defaultStoreSecretKey ?? DEFAULT_STORE_SECRET_KEY;
    this.runtime = options.runtime;

    const parsedEndpoint = this.parseEndpoint(options.endpoint);

    this.workspaceHost = options.workspaceHost ?? parsedEndpoint.hostname;
    this.workspacePort = options.workspacePort ?? parsedEndpoint.port;
    this.workspaceUseSSL = options.workspaceUseSSL ?? parsedEndpoint.useSSL;

    this.mapStoreIdToBucketName = options.mapStoreIdToBucketName;
    this.mapWorkspaceToStoreConfig = options.mapWorkspaceToStoreConfig;

    this.minioAdminService = new MinioAdminManager({
      endpoint: options.endpoint,
      containerName: options.containerName,
      rootUser: options.rootUser,
      rootPassword: options.rootPassword,
      alias: options.alias,
      runtime: options.runtime,
    });
  }

  private parseEndpoint(endpoint: string) {
    const parsed = new URL(endpoint);
    const useSSL = parsed.protocol === "https:";
    const port = parsed.port ? Number(parsed.port) : useSSL ? 443 : 80;

    return {
      hostname: parsed.hostname,
      port,
      useSSL,
    };
  }

  async getStore(storeId: string) {
    const list = await this.minioAdminService.listBuckets();

    const workspacesByBucket = Object.fromEntries(
      list.workspaces.map((workspace) => {
        const fallback = {
          bucket: workspace.bucket,
          accessKey: workspace.username,
          secretKey: this.defaultStoreSecretKey,
          host: this.workspaceHost,
          port: this.workspacePort,
          useSSL: this.workspaceUseSSL,
        } satisfies S3StoreConfig;

        const mapped = this.mapWorkspaceToStoreConfig?.(
          {
            bucket: workspace.bucket,
            username: workspace.username,
          },
          fallback
        );

        return [workspace.bucket, mapped ?? fallback];
      })
    );

    const expectedBucketName =
      this.mapStoreIdToBucketName?.(storeId, this.storeBucketPrefix) ?? `${this.storeBucketPrefix}${storeId}`;

    const s3StoreConfig = workspacesByBucket[expectedBucketName];
    if (!s3StoreConfig) {
      throw new MinioWorkspaceError({ status: 404, code: "store_not_found", message: storeId });
    }

    return s3StoreConfig;
  }

  async minioBucketService(storeId: string) {
    const bucket = new MinioBucketManager(await this.getStore(storeId), this.runtime);
    return bucket;
  }
}

export function createMinioWorkspaceService(options: MinioWorkspaceServiceOptions) {
  return new MinioWorkspaceService(options);
}
