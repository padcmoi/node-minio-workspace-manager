export type MinioWorkspaceErrorOptions = {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
};

export class MinioWorkspaceError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(options: MinioWorkspaceErrorOptions) {
    super(options.message ?? options.code ?? "MINIO_WORKSPACE_ERROR");
    this.name = "MinioWorkspaceError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}
