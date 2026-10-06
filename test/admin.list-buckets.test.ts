import { describe, expect, it, vi } from "vitest";
import { MinioAdminManager } from "../src/minio-admin";

type ExecResult = { stdout: string; stderr: string } | null;

const LS = [
  "[2026-10-06 08:46:09 UTC]     0B bucket-store-demo/",
  "[2026-10-06 08:46:09 UTC]     0B bucket-store-archive/",
].join("\n");

const METRICS = [
  "# HELP minio_bucket_usage_object_total Total number of objects",
  "# TYPE minio_bucket_usage_object_total gauge",
  'minio_bucket_usage_object_total{bucket="bucket-store-demo",server="127.0.0.1:9000"} 124042',
  'minio_bucket_usage_total_bytes{bucket="bucket-store-demo",server="127.0.0.1:9000"} 8.096241557e+09',
  'minio_bucket_quota_total_bytes{bucket="bucket-store-demo",server="127.0.0.1:9000"} 2e+10',
  'minio_bucket_usage_object_total{bucket="bucket-store-archive",server="127.0.0.1:9000"} 0',
  'minio_bucket_usage_total_bytes{bucket="bucket-store-archive",server="127.0.0.1:9000"} 0',
].join("\n");

const USERS = [
  '{"status":"success","accessKey":"user-store-demo","policyName":"custom-policy-store-demo","userStatus":"enabled"}',
  '{"status":"success","accessKey":"user-store-archive","policyName":"custom-policy-store-archive","userStatus":"disabled"}',
].join("\n");

function admin(answer: (command: string) => ExecResult) {
  const manager = new MinioAdminManager({
    endpoint: "http://minio:9000",
    alias: "svc-main",
    containerName: "minio_container",
    rootUser: "root",
    rootPassword: "root-password",
  });

  manager.ensureInit = vi.fn(async () => undefined);

  const execAsync = vi.fn((command: string) => Promise.resolve(answer(command)));

  (manager as unknown as { execAsync: (command: string) => Promise<ExecResult> }).execAsync = execAsync;

  const ran = (needle: string) => execAsync.mock.calls.some(([command]) => String(command).includes(needle));

  return { manager, ran };
}

const ok = (stdout: string) => ({ stdout, stderr: "" });

describe("MinioAdminManager.listBuckets", () => {
  it("reads the usage from the server gauges rather than walking every bucket", async () => {
    const { manager, ran } = admin((command) => {
      if (command.includes("mc admin prometheus metrics")) return ok(METRICS);
      if (command.includes("mc admin user list")) return ok(USERS);
      if (command.includes("mc ls")) return ok(LS);
      return ok("");
    });

    const listed = await manager.listBuckets();

    expect(listed.count).toBe(2);
    expect(listed.workspaces[0]).toEqual({
      bucket: "bucket-store-demo",
      username: "user-store-demo",
      objects: 124042,
      quota: { enable: true, usage: 8096241557, hard: 20000000000 },
      userStatus: "enabled",
    });
    // No quota gauge means no quota, not a missing figure to go and fetch.
    expect(listed.workspaces[1]?.quota).toEqual({ enable: false, usage: 0 });
    expect(listed.workspaces[1]?.userStatus).toBe("disabled");

    expect(ran("mc du")).toBe(false);
    expect(ran("mc admin user info")).toBe(false);
  });

  it("counts a bucket the scanner has no figure for", async () => {
    const { manager, ran } = admin((command) => {
      if (command.includes("mc admin prometheus metrics")) {
        return ok('minio_bucket_usage_object_total{bucket="bucket-store-demo",server="a"} 2\n' + 'minio_bucket_usage_total_bytes{bucket="bucket-store-demo",server="a"} 5');
      }
      if (command.includes("mc admin user list")) return ok(USERS);
      if (command.includes("mc du")) return ok('{"prefix":"bucket-store-archive","size":42,"objects":7,"status":"success"}');
      if (command.includes("mc quota info")) return ok('{"status":"success","quota":1024}');
      if (command.includes("mc ls")) return ok(LS);
      return ok("");
    });

    const listed = await manager.listBuckets();

    expect(ran("mc du")).toBe(true);
    expect(listed.workspaces[0]?.objects).toBe(2);
    expect(listed.workspaces[1]).toMatchObject({
      bucket: "bucket-store-archive",
      objects: 7,
      quota: { enable: true, usage: 42, hard: 1024 },
    });
  });

  it("falls back to one read per account when the user list cannot be read", async () => {
    const { manager, ran } = admin((command) => {
      if (command.includes("mc admin user list")) return null;
      if (command.includes("mc admin user info")) return ok("AccessKey: user-x\nStatus: enabled\n");
      if (command.includes("mc admin prometheus metrics")) return ok(METRICS);
      if (command.includes("mc ls")) return ok(LS);
      return ok("");
    });

    const listed = await manager.listBuckets();

    expect(ran("mc admin user info")).toBe(true);
    expect(listed.count).toBe(2);
    expect(listed.workspaces.every((workspace) => workspace.userStatus === "enabled")).toBe(true);
  });

  it("leaves out a bucket that has no account", async () => {
    const { manager } = admin((command) => {
      if (command.includes("mc admin prometheus metrics")) return ok(METRICS);
      if (command.includes("mc admin user list")) {
        return ok('{"status":"success","accessKey":"user-store-demo","userStatus":"enabled"}');
      }
      if (command.includes("mc ls")) return ok(LS);
      return ok("");
    });

    const listed = await manager.listBuckets();

    expect(listed.count).toBe(1);
    expect(listed.workspaces[0]?.bucket).toBe("bucket-store-demo");
  });
});

describe("MinioAdminManager.getMinioMetrics", () => {
  it("takes the server usage from the cluster gauge instead of walking it", async () => {
    const { manager, ran } = admin((command) => {
      if (command.includes("mc admin prometheus metrics")) {
        return ok(
          [
            'minio_cluster_usage_object_total{server="127.0.0.1:9000"} 148560',
            'minio_cluster_usage_total_bytes{server="127.0.0.1:9000"} 1.8535844252e+10',
          ].join("\n")
        );
      }
      if (command.includes("mc admin info")) return ok('{"version":"RELEASE.2025-04-22T22-12-26Z","mode":"online"}');
      return ok("");
    });

    const metrics = await manager.getMinioMetrics();

    expect(metrics.usage).toEqual({ objects: 148560, usage: 18535844252 });
    expect(ran("mc du")).toBe(false);
  });

  it("walks the server when the gauge is not served", async () => {
    const { manager, ran } = admin((command) => {
      if (command.includes("mc admin prometheus metrics")) return null;
      if (command.includes("mc du")) return ok('{"prefix":"svc-main","size":12,"objects":3,"status":"success"}');
      return ok("{}");
    });

    const metrics = await manager.getMinioMetrics();

    expect(ran("mc du")).toBe(true);
    expect(metrics.usage).toEqual({ objects: 3, usage: 12 });
  });
});

describe("MinioAdminManager.findWorkspace", () => {
  it("answers from the bucket alone, without listing the server", async () => {
    const { manager, ran } = admin((command) => {
      if (command.includes("mc stat")) return ok('{"status":"success","name":"bucket-store-demo/"}');
      if (command.includes("mc admin user info")) return ok("Status: enabled\n");
      return ok("");
    });

    await expect(manager.findWorkspace("bucket-store-demo")).resolves.toEqual({
      bucket: "bucket-store-demo",
      username: "user-store-demo",
      userStatus: "enabled",
    });

    expect(ran("mc du")).toBe(false);
    expect(ran("mc admin prometheus")).toBe(false);
  });

  it("returns nothing for a bucket that is not there", async () => {
    const { manager } = admin((command) => (command.includes("mc stat") ? null : ok("")));

    await expect(manager.findWorkspace("bucket-store-missing")).resolves.toBeNull();
  });

  it("returns nothing for a bucket whose account is gone", async () => {
    const { manager } = admin((command) => {
      if (command.includes("mc stat")) return ok('{"status":"success"}');
      if (command.includes("mc admin user info")) return null;
      return ok("");
    });

    await expect(manager.findWorkspace("bucket-store-demo")).resolves.toBeNull();
  });
});
