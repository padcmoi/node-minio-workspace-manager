import { describe, expect, it, vi } from "vitest";
import { MinioWorkspaceError } from "../src/error";
import { MinioBucketManager } from "../src/minio-bucket";
import { MinioWorkspaceService } from "../src/service";

describe("MinioWorkspaceService", () => {
  it("resolves store config from listed workspaces", async () => {
    const service = new MinioWorkspaceService({
      endpoint: "http://minio:9000",
      alias: "svc-main",
      containerName: "minio_container",
      rootUser: "root",
      rootPassword: "root-password",
    });

    const findWorkspace = vi.fn(async () => ({
      bucket: "bucket-store-demo",
      username: "user-store-demo",
      userStatus: "enabled" as const,
    }));

    service.minioAdminService.findWorkspace = findWorkspace;
    service.minioAdminService.listBuckets = vi.fn(async () => {
      throw new Error("getStore must not list the whole server");
    });

    const store = await service.getStore("demo");

    expect(findWorkspace).toHaveBeenCalledWith("bucket-store-demo");
    expect(store.bucket).toBe("bucket-store-demo");
    expect(store.accessKey).toBe("user-store-demo");
    expect(store.secretKey).toBe("123456789");
    expect(store.host).toBe("minio");
    expect(store.port).toBe(9000);
    expect(store.useSSL).toBe(false);

    const bucket = await service.minioBucketService("demo");
    expect(bucket).toBeInstanceOf(MinioBucketManager);
  });

  it("throws store_not_found when workspace does not exist", async () => {
    const service = new MinioWorkspaceService({
      endpoint: "http://minio:9000",
      alias: "svc-main",
      containerName: "minio_container",
      rootUser: "root",
      rootPassword: "root-password",
    });

    service.minioAdminService.findWorkspace = vi.fn(async () => null);

    await expect(service.getStore("unknown")).rejects.toMatchObject({
      code: "store_not_found",
    } satisfies Pick<MinioWorkspaceError, "code">);
  });
});
