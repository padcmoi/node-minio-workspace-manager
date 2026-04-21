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

    service.minioAdminService.listBuckets = vi.fn(async () => ({
      count: 1,
      workspaces: [
        {
          bucket: "bucket-store-demo",
          username: "user-store-demo",
          objects: 0,
          quota: { enable: false, usage: 0 },
          userStatus: "enabled" as const,
        },
      ],
    }));

    const store = await service.getStore("demo");
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

    service.minioAdminService.listBuckets = vi.fn(async () => ({
      count: 0,
      workspaces: [],
    }));

    await expect(service.getStore("unknown")).rejects.toMatchObject({
      code: "store_not_found",
    } satisfies Pick<MinioWorkspaceError, "code">);
  });
});
