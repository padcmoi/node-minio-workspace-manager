import { describe, expect, it, vi } from "vitest";
import { MinioWorkspaceError } from "../src/error";
import { MinioAdminManager } from "../src/minio-admin";
import { MinioBucketManager } from "../src/minio-bucket";

describe("MinioAdminManager", () => {
  it("requires password on user creation", async () => {
    const admin = new MinioAdminManager({
      endpoint: "http://minio:9000",
      alias: "svc-main",
      containerName: "minio_container",
      rootUser: "root",
      rootPassword: "root-password",
    });

    admin.ensureInit = vi.fn(async () => undefined);

    const originalExec = (
      admin as unknown as { execAsync: (command: string, opts?: { ignoreError?: boolean; ctx?: string }) => Promise<unknown> }
    ).execAsync;

    (
      admin as unknown as { execAsync: (command: string, opts?: { ignoreError?: boolean; ctx?: string }) => Promise<unknown> }
    ).execAsync = vi.fn(async (command: string) => {
      if (command.includes("mc admin user info")) {
        throw new Error("user_not_found");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(admin.upsertBucket("store-demo")).rejects.toMatchObject({
      code: "password_required_for_creation",
    } satisfies Pick<MinioWorkspaceError, "code">);

    (
      admin as unknown as { execAsync: (command: string, opts?: { ignoreError?: boolean; ctx?: string }) => Promise<unknown> }
    ).execAsync = originalExec;
  });
});

describe("MinioBucketManager", () => {
  it("parses listObjects output", async () => {
    const bucket = new MinioBucketManager({
      bucket: "bucket-store-demo",
      accessKey: "user-store-demo",
      secretKey: "123456789",
      host: "minio",
      port: 9000,
      useSSL: false,
    });

    bucket.ensureInit = vi.fn(async () => undefined);

    (
      bucket as unknown as {
        execAsync: (
          command: string,
          opts?: { ignoreError?: boolean; ctx?: string }
        ) => Promise<{ stdout: string; stderr: string }>;
      }
    ).execAsync = vi.fn(async () => ({
      stdout: ['{"key":"demo/file-1.txt","size":12,"etag":"abc","lastModified":"2026-04-21T00:00:00Z"}'].join("\n"),
      stderr: "",
    }));

    const listed = await bucket.listObjects("demo");

    expect(listed.count).toBe(1);
    expect(listed.objects[0]?.key).toBe("demo/file-1.txt");
    expect(listed.objects[0]?.size).toBe(12);
  });

  it("maps download errors to not_found", async () => {
    const bucket = new MinioBucketManager({
      bucket: "bucket-store-demo",
      accessKey: "user-store-demo",
      secretKey: "123456789",
      host: "minio",
      port: 9000,
      useSSL: false,
    });

    bucket.ensureInit = vi.fn(async () => undefined);

    (
      bucket as unknown as {
        execAsyncBuffer: (command: string, opts?: { ignoreError?: boolean; ctx?: string }) => Promise<Buffer>;
      }
    ).execAsyncBuffer = vi.fn(async () => {
      throw new Error("missing");
    });

    await expect(bucket.downloadObjectBuffer("demo", "file.txt")).rejects.toMatchObject({
      code: "not_found",
    } satisfies Pick<MinioWorkspaceError, "code">);
  });
});
