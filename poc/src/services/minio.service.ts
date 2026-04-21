import { MinioWorkspaceError, MinioWorkspaceService, type UploadedFile } from "@naskot/node-minio-workspace-manager";

const endpoint = process.env.MINIO_ENDPOINT ?? "http://minio:9000";
const containerName = process.env.MINIO_CONTAINER_NAME ?? "ast_minio_poc";
const rootUser = process.env.MINIO_ROOT_USER ?? "admin";
const rootPassword = process.env.MINIO_ROOT_PASSWORD ?? "ChangeThisPassword123!";
const alias = process.env.MINIO_ALIAS ?? "ast-minio-poc";

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
