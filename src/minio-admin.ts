import { createHash } from "node:crypto";
import { buildPolicyJson } from "./deps/default-policies";
import { shQuote } from "./deps/utils";
import { MinioWorkspaceError } from "./error";
import { MinioExtends } from "./minio-extends";
import type {
  JsonArray,
  JsonObject,
  MinioAdminManagerOptions,
  MinioBucketEnabledResponse,
  MinioBucketInfoResponse,
  MinioDeleteBucketResponse,
  MinioListBucketsResponse,
  MinioMetricsResponse,
  MinioUpsertBucketResponse,
  UpsertBucketOptions,
} from "./types";

export class MinioAdminManager extends MinioExtends {
  constructor(options: MinioAdminManagerOptions) {
    super(options.runtime);
    this.endpoint = options.endpoint;

    const rawAlias = (options.alias ?? "default_minio_alias").trim() || "default_minio_alias";
    const hash = createHash("md5").update(rawAlias, "utf8").digest("hex");
    this.alias = `m_${hash}`;

    this.accessKey = options.rootUser;
    this.secretKey = options.rootPassword;
  }

  async upsertBucket(name: string, options: UpsertBucketOptions = {}) {
    await this.ensureInit();

    const quotaRaw = typeof options.quotaMb === "number" && options.quotaMb > 0 ? options.quotaMb : 500;
    const quotaFormatted = `${quotaRaw}MB`;
    const password = options.password?.trim() || "";

    const { bucket, username, policyName } = this.resolveNames(name);

    let userExists = true;
    try {
      await this.execAsync(`mc admin user info ${shQuote(this.alias)} ${shQuote(username)}`, { ignoreError: true });
    } catch {
      userExists = false;
    }

    if (!userExists && !password) {
      throw new MinioWorkspaceError({ status: 400, code: "password_required_for_creation" });
    }

    const fs = await import("node:fs/promises");

    const policyJSON = buildPolicyJson(bucket);
    const localPolicyPath = `/tmp/${policyName}.json`;

    await fs.writeFile(localPolicyPath, policyJSON, "utf8");

    await this.execAsync(`mc mb ${shQuote(`${this.alias}/${bucket}`)}`);

    let userCreated = false;
    let passwordChanged = false;

    if (!userExists) {
      await this.execAsync(`mc admin user add ${shQuote(this.alias)} ${shQuote(username)} ${shQuote(password)}`);
      userCreated = true;
      passwordChanged = true;
    } else if (password) {
      await this.execAsync(`mc admin user add ${shQuote(this.alias)} ${shQuote(username)} ${shQuote(password)}`);
      passwordChanged = true;
    }

    await this.execAsync(`mc admin policy create ${shQuote(this.alias)} ${shQuote(policyName)} ${shQuote(localPolicyPath)}`);
    await this.execAsync(`mc admin policy attach ${shQuote(this.alias)} --user ${shQuote(username)} ${shQuote(policyName)}`);
    await this.execAsync(`mc quota set ${shQuote(`${this.alias}/${bucket}`)} --size ${shQuote(quotaFormatted)}`);

    try {
      await fs.unlink(localPolicyPath);
    } catch {
      // ignore tmp cleanup failure
    }

    await this.resetStateQuota(bucket);

    return {
      bucket,
      username,
      userCreated,
      passwordChanged,
      policy: policyName,
      quota: quotaFormatted,
    } satisfies MinioUpsertBucketResponse;
  }

  async deleteBucket(name: string) {
    await this.ensureInit();

    const { bucket, username, policyName } = this.resolveNames(name);

    let exists = true;
    try {
      await this.execAsync(`mc ls ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true });
    } catch {
      exists = false;
    }

    if (!exists) {
      return {
        bucket,
        username,
        policy: policyName,
        deleted: false,
        reason: "not_found",
      } satisfies MinioDeleteBucketResponse;
    }

    await this.execAsync(`mc admin policy detach ${shQuote(this.alias)} --user ${shQuote(username)} ${shQuote(policyName)}`, {
      ignoreError: true,
    });
    await this.execAsync(`mc admin policy remove ${shQuote(this.alias)} ${shQuote(policyName)}`, { ignoreError: true });
    await this.execAsync(`mc admin user remove ${shQuote(this.alias)} ${shQuote(username)}`, { ignoreError: true });
    await this.execAsync(`mc rb ${shQuote(`${this.alias}/${bucket}`)} --force --dangerous`, { ignoreError: true });

    delete this.quotasState[bucket];

    return {
      bucket,
      username,
      policy: policyName,
      deleted: true,
    } satisfies MinioDeleteBucketResponse;
  }

  async listBuckets() {
    await this.ensureInit();

    const { stdout } = await this.execAsync(`mc ls ${shQuote(this.alias)}`);

    const workspaces: MinioListBucketsResponse["workspaces"] = [];

    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/bucket-([a-z0-9-]+)\//);
      if (!match) continue;

      const safeName = match[1];
      const bucket = `bucket-${safeName}`;
      const username = `user-${safeName}`;

      let objects = 0;
      let usageQuota = 0;

      await this.resetStateQuota(bucket);

      try {
        const { stdout: duOut } = await this.execAsync(`mc du --json ${shQuote(`${this.alias}/${bucket}`)}`);
        const du = this.parseDuJson(duOut);
        if (du) {
          objects = du.objects;
          usageQuota = du.size;
        }
      } catch {
        // ignore per-bucket read failure
      }

      let hardQuota: number | null = null;

      try {
        const { stdout: quotaOut } = await this.execAsync(`mc quota info ${shQuote(`${this.alias}/${bucket}`)} --json`);
        const quota = this.parseQuotaInfoJson(quotaOut);
        if (quota) hardQuota = quota.quota;
      } catch {
        // ignore quota read failure
      }

      let userStatus: "enabled" | "disabled" | "unknown" = "unknown";

      try {
        const { stdout: userOut } = await this.execAsync(`mc admin user info ${shQuote(this.alias)} ${shQuote(username)}`);
        if (/Status:\s+enabled/i.test(userOut)) userStatus = "enabled";
        if (/Status:\s+disabled/i.test(userOut)) userStatus = "disabled";
      } catch {
        // ignore user read failure
      }

      if (userStatus === "unknown") continue;

      workspaces.push({
        bucket,
        username,
        objects,
        quota: {
          enable: !!hardQuota,
          usage: usageQuota,
          ...(hardQuota ? { hard: hardQuota } : {}),
        },
        userStatus,
      });
    }

    return {
      count: workspaces.length,
      workspaces,
    } satisfies MinioListBucketsResponse;
  }

  async getBucketInfo(name: string) {
    await this.ensureInit();

    const { bucket, username, policyName } = this.resolveNames(name);

    await this.resetStateQuota(bucket);

    try {
      await this.execAsync(`mc ls ${shQuote(`${this.alias}/${bucket}`)}`);
    } catch {
      return {
        bucket,
        username,
        policy: policyName,
        exists: false,
        reason: "not_found",
      } satisfies MinioBucketInfoResponse;
    }

    let objects = 0;
    let usageQuota = 0;

    try {
      const { stdout } = await this.execAsync(`mc du --json ${shQuote(`${this.alias}/${bucket}`)}`);
      const du = this.parseDuJson(stdout);
      if (du) {
        objects = du.objects;
        usageQuota = du.size;
      }
    } catch {
      // ignore du read failure
    }

    let hardQuota: number | null = null;
    try {
      const { stdout } = await this.execAsync(`mc quota info ${shQuote(`${this.alias}/${bucket}`)} --json`);
      const quota = this.parseQuotaInfoJson(stdout);
      if (quota) hardQuota = quota.quota;
    } catch {
      // ignore quota read failure
    }

    let encryption = "disabled";
    try {
      await this.execAsync(`mc encrypt info ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true });
      encryption = "enabled";
    } catch {
      // ignore encryption read failure
    }

    let replication = "disabled";
    try {
      await this.execAsync(`mc replicate ls ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true });
      replication = "enabled";
    } catch {
      // ignore replication read failure
    }

    let objectLocking = "disabled";
    try {
      await this.execAsync(`mc retention info ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true });
      objectLocking = "enabled";
    } catch {
      // ignore object lock read failure
    }

    let userStatus: "enabled" | "disabled" | "unknown" = "unknown";
    try {
      const { stdout } = await this.execAsync(`mc admin user info ${shQuote(this.alias)} ${shQuote(username)}`);
      if (/Status:\s+enabled/i.test(stdout)) userStatus = "enabled";
      if (/Status:\s+disabled/i.test(stdout)) userStatus = "disabled";
    } catch {
      // ignore user status read failure
    }

    if (userStatus === "unknown") return { exists: false } satisfies MinioBucketInfoResponse;

    return {
      bucket,
      username,
      policy: policyName,
      exists: true,
      objects,
      quota: {
        enable: !!hardQuota,
        usage: usageQuota,
        ...(hardQuota ? { hard: hardQuota } : {}),
      },
      encryption,
      replication,
      objectLocking,
      userStatus,
    } satisfies MinioBucketInfoResponse;
  }

  async setBucketEnabled(name: string, enabled: boolean) {
    await this.ensureInit();

    const { username } = this.resolveNames(name);

    if (enabled) {
      await this.execAsync(`mc admin user enable ${shQuote(this.alias)} ${shQuote(username)}`);
    } else {
      await this.execAsync(`mc admin user disable ${shQuote(this.alias)} ${shQuote(username)}`);
    }

    return {
      username,
      enabled,
    } satisfies MinioBucketEnabledResponse;
  }

  async getMinioMetrics() {
    let adminInfo: {
      version: string | null;
      uptime: string | number | null;
      region: string | null;
      mode: string | null;
      pools: JsonArray;
      disks: JsonArray;
      raw: JsonObject;
    } | null = null;

    try {
      const { stdout } = await this.execAsync(`mc admin info ${shQuote(this.alias)} --json`);
      adminInfo = this.parseAdminInfoJson(stdout);
    } catch {
      // ignore admin info failure
    }

    const globalUsage = {
      objects: 0,
      usage: 0,
    };

    try {
      const { stdout } = await this.execAsync(`mc du --json ${shQuote(this.alias)}`);
      const du = this.parseDuJson(stdout);
      if (du) {
        globalUsage.objects = du.objects;
        globalUsage.usage = du.size;
      }
    } catch {
      // ignore global usage failure
    }

    return {
      server: {
        version: adminInfo?.version ?? null,
        uptime: adminInfo?.uptime ?? null,
        region: adminInfo?.region ?? null,
        mode: adminInfo?.mode ?? null,
      },
      storage: {
        pools: adminInfo?.pools ?? [],
        disks: adminInfo?.disks ?? [],
      },
      usage: globalUsage,
      raw: adminInfo?.raw ?? null,
    } satisfies MinioMetricsResponse;
  }

  async resetStateQuota(bucket: string) {
    await this.ensureInit(bucket);

    const quota: Record<string, number | undefined> = {};

    try {
      const { stdout } = await this.execAsync(`mc quota info --json ${shQuote(this.alias)}/${shQuote(bucket)}`);
      const line = stdout.trim().split("\n").pop() ?? "";
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) {
        const q = (parsed as Record<string, unknown>).quota;
        if (typeof q === "number") quota.hard = q;
      }
    } catch {
      // ignore quota info failure
    }

    quota.cur = await this.currentQuota(bucket);

    const state = this.getQuotaState(bucket);
    if (quota.cur !== undefined) state.cur = quota.cur;
    if (quota.hard !== undefined) state.hard = quota.hard;

    return { quota };
  }
}
