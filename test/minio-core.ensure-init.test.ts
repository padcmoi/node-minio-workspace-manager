import { describe, expect, it, vi } from "vitest";
import { MinioWorkspaceError } from "../src/error";
import { MinioBucketManager } from "../src/minio-bucket";

function createBucket(accessKey: string) {
  return new MinioBucketManager({
    bucket: "bucket-store-demo",
    accessKey,
    secretKey: "123456789",
    host: "minio",
    port: 9000,
    useSSL: false,
  });
}

describe("MinioCore.ensureInit", () => {
  it("maps workspace credential mismatch to workspace_auth_failed", async () => {
    const bucket = createBucket("user-store-demo-auth-1");

    const execRaw = vi.fn(async () => {
      const error = Object.assign(new Error("invalid credentials"), {
        stderr: "Unable to initialize new alias from the provided credentials",
      });
      throw error;
    });

    (bucket as unknown as { execAsyncRaw: (command: string) => Promise<unknown> }).execAsyncRaw = execRaw;

    await expect(bucket.ensureInit("bucket-store-demo")).rejects.toMatchObject({
      status: 401,
      code: "workspace_auth_failed",
    } satisfies Pick<MinioWorkspaceError, "status" | "code">);
  });

  it("does not keep alias marked initialized when init fails", async () => {
    const bucket = createBucket("user-store-demo-auth-2");

    const execRaw = vi.fn(async () => {
      const error = Object.assign(new Error("network"), {
        stderr: "dial tcp 127.0.0.1:9000: connect: connection refused",
      });
      throw error;
    });

    (bucket as unknown as { execAsyncRaw: (command: string) => Promise<unknown> }).execAsyncRaw = execRaw;

    await expect(bucket.ensureInit("bucket-store-demo")).rejects.toMatchObject({
      code: "storage_unreachable",
    } satisfies Pick<MinioWorkspaceError, "code">);

    await expect(bucket.ensureInit("bucket-store-demo")).rejects.toMatchObject({
      code: "storage_unreachable",
    } satisfies Pick<MinioWorkspaceError, "code">);

    expect(execRaw).toHaveBeenCalledTimes(2);
  });
});
