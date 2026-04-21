import { describe, expect, it, vi } from "vitest";
import { MinioWorkspaceService } from "../src/service";

describe("integration: workspace flow", () => {
  it("connects service -> bucket manager -> listObjects flow", async () => {
    const service = new MinioWorkspaceService({
      endpoint: "http://127.0.0.1:9000",
      alias: "svc-main",
      containerName: "minio_container",
      rootUser: "root",
      rootPassword: "root-password",
      runtime: { enabled: true },
    });

    service.minioAdminService.listBuckets = vi.fn(async () => ({
      count: 1,
      workspaces: [
        {
          bucket: "bucket-store-demo",
          username: "user-store-demo",
          objects: 1,
          quota: { enable: true, hard: 500 * 1024 * 1024, usage: 10 },
          userStatus: "enabled" as const,
        },
      ],
    }));

    const bucket = await service.minioBucketService("demo");

    bucket.ensureInit = vi.fn(async () => undefined);
    (
      bucket as unknown as {
        execAsync: (
          command: string,
          opts?: { ignoreError?: boolean; ctx?: string }
        ) => Promise<{ stdout: string; stderr: string }>;
      }
    ).execAsync = vi.fn(async () => ({
      stdout: '{"key":"demo/hello.txt","size":5,"etag":"abc","lastModified":"2026-04-21T00:00:00Z"}',
      stderr: "",
    }));

    const result = await bucket.listObjects("demo");

    expect(result.count).toBe(1);
    expect(result.objects[0]?.key).toBe("demo/hello.txt");
  });
});
