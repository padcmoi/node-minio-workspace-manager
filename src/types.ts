export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type JsonObject = {
  [key: string]: JsonValue;
};

export type JsonArray = JsonValue[];

export type MinioLogger = {
  info?: (message: string, meta?: unknown) => void;
  warn?: (message: string, meta?: unknown) => void;
  error?: (message: string, meta?: unknown) => void;
};

export type MinioRuntimeOptions = {
  enabled?: boolean;
  logger?: MinioLogger;
};

export type ExecAsyncResult = { stdout: string; stderr: string };

export type ExecAsyncOptsBase = {
  ignoreError?: boolean;
  ctx?: string;
};

export type MinioAdminManagerOptions = {
  endpoint: string;
  alias: string;
  containerName: string;
  rootUser: string;
  rootPassword: string;
  runtime?: MinioRuntimeOptions;
};

export type S3StoreConfig = {
  bucket: string;
  accessKey: string;
  secretKey: string;
  host: string;
  port: number;
  useSSL: boolean;
};

export type MinioUserListItem = {
  key: string;
  k?: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
};

export type MinioUserUploadItem = {
  ref: string;
  key: string;
  size: number;
};

export type UploadedFile = { originalname: string; buffer: Buffer; size: number };

export type BucketQuota = { hard: number; cur: number };

export type BucketQuotaState = Record<string, BucketQuota>;

export type UpsertBucketOptions = {
  quotaMb?: number;
  password?: string;
};

export type MinioUpsertBucketResponse = {
  bucket: string;
  username: string;
  userCreated: boolean;
  passwordChanged: boolean;
  policy: string;
  quota: string;
};

export type MinioDeleteBucketResponse = {
  bucket: string;
  username: string;
  policy: string;
  deleted: boolean;
  reason?: string;
};

export type MinioListBucketsResponse = {
  count: number;
  workspaces: {
    bucket: string;
    username: string;
    objects: number;
    quota: {
      hard?: number;
      enable: boolean;
      usage: number;
    };
    userStatus: "enabled" | "disabled";
  }[];
};

export type MinioBucketInfoResponse =
  | {
      bucket: string;
      username: string;
      policy: string;
      exists: false;
      reason: "not_found";
    }
  | {
      exists: false;
    }
  | {
      bucket: string;
      username: string;
      policy: string;
      exists: true;
      objects: number;
      quota: {
        enable: boolean;
        usage: number;
        hard?: number;
      };
      encryption: string;
      replication: string;
      objectLocking: string;
      userStatus: "enabled" | "disabled";
    };

export type MinioBucketEnabledResponse = {
  username: string;
  enabled: boolean;
};

export type MinioMetricsResponse = {
  server: {
    version: string | null;
    uptime: number | string | null;
    region: string | null;
    mode: string | null;
  };
  storage: {
    pools: JsonArray;
    disks: JsonArray;
  };
  usage: {
    objects: number;
    usage: number;
  };
  raw: JsonObject | null;
};

export type MinioWorkspaceStoreDescriptor = {
  bucket: string;
  username: string;
};

export type MinioWorkspaceServiceOptions = {
  endpoint: string;
  alias: string;
  containerName: string;
  rootUser: string;
  rootPassword: string;
  storeBucketPrefix?: string;
  defaultStoreSecretKey?: string;
  workspaceHost?: string;
  workspacePort?: number;
  workspaceUseSSL?: boolean;
  runtime?: MinioRuntimeOptions;
  mapStoreIdToBucketName?: (storeId: string, prefix: string) => string;
  mapWorkspaceToStoreConfig?: (workspace: MinioWorkspaceStoreDescriptor, fallback: S3StoreConfig) => S3StoreConfig;
};
