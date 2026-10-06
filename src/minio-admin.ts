import { createHash } from "node:crypto";
import { buildPolicyJson } from "./deps/default-policies";
import { mapWithConcurrency, shQuote } from "./deps/utils";
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

/** `mc du` is a walk over every object, so the buckets that still need one are read a few at a time. */
const USAGE_FALLBACK_CONCURRENCY = 4;

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

    const userExists =
      (await this.execAsync(`mc admin user info ${shQuote(this.alias)} ${shQuote(username)}`, { ignoreError: true })) !== null;

    if (!userExists && !password) {
      throw new MinioWorkspaceError({ status: 400, code: "password_required_for_creation" });
    }

    const fs = await import("node:fs/promises");

    const policyJSON = buildPolicyJson(bucket);
    const localPolicyPath = `/tmp/${policyName}.json`;

    await fs.writeFile(localPolicyPath, policyJSON, "utf8");

    await this.execAsync(`mc mb --ignore-existing ${shQuote(`${this.alias}/${bucket}`)}`);

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

    const bucketExists = (await this.execAsync(`mc ls ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true })) !== null;

    if (!bucketExists) {
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

  /**
   * One `mc ls` for the names, then two server-wide reads for everything else:
   * the bucket gauges MinIO publishes, and the list of accounts.
   *
   * It used to spend five `mc` processes per bucket, two of them a `mc du` that
   * walks every object to add up a size the server already holds. On a bucket of
   * 120k objects that walk is seven seconds, and it was paid twice per bucket,
   * once by `resetStateQuota` for a figure nothing read back.
   *
   * The gauges come from the data usage scanner, so they trail reality by a scan
   * cycle instead of being counted on the spot. A bucket the scanner has no
   * figure for - a server too old for the endpoint, a bucket created a moment
   * ago - still gets the exact `mc du` below.
   */
  async listBuckets() {
    await this.ensureInit();

    const { stdout } = await this.execAsync(`mc ls ${shQuote(this.alias)}`);

    const listed: { bucket: string; username: string }[] = [];

    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/bucket-([a-z0-9-]+)\//);
      if (!match) continue;

      listed.push({ bucket: `bucket-${match[1]}`, username: `user-${match[1]}` });
    }

    const [metrics, users] = await Promise.all([this.readBucketMetrics(), this.readUserStatuses()]);

    // Only the usage is worth a round trip of its own: a bucket with no quota
    // set has no quota gauge, and that absence is the answer, not a gap.
    const unscanned = listed.filter(({ bucket }) => {
      const entry = metrics.get(bucket);
      return entry?.objects === undefined || entry.usage === undefined;
    });

    const measured = new Map(
      (
        await mapWithConcurrency(unscanned, USAGE_FALLBACK_CONCURRENCY, async ({ bucket }) => ({
          bucket,
          usage: await this.readBucketUsage(bucket),
        }))
      ).map(({ bucket, usage }) => [bucket, usage])
    );

    const workspaces: MinioListBucketsResponse["workspaces"] = [];

    for (const { bucket, username } of listed) {
      // A bucket whose account cannot be read is left out, as it always was:
      // what this lists are workspaces, and half of one is not a workspace.
      const userStatus = users ? (users.get(username) ?? null) : await this.readUserStatus(username);
      if (!userStatus) continue;

      // What was counted on the spot wins over what the scanner published, and
      // keeps the quota gauge when the count is all that was missing.
      const usage = { ...metrics.get(bucket), ...measured.get(bucket) };
      const hardQuota = usage.hard ?? null;

      workspaces.push({
        bucket,
        username,
        objects: usage.objects ?? 0,
        quota: {
          enable: !!hardQuota,
          usage: usage.usage ?? 0,
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

  /**
   * Whether this bucket exists and has an account, and nothing else.
   *
   * `getStore` used to ask `listBuckets` for it, so resolving one store to open
   * one file cost a walk over every object of every bucket on the server.
   */
  async findWorkspace(bucket: string) {
    await this.ensureInit();

    const match = /^bucket-([a-z0-9-]+)$/.exec(bucket.trim());
    if (!match) return null;

    const username = `user-${match[1]}`;

    // `mc stat` rather than `mc ls`: it answers from the bucket's own record
    // instead of listing what is inside it.
    const stat = await this.execAsync(`mc stat --json ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true });
    if (!stat) return null;

    const userStatus = await this.readUserStatus(username);
    if (!userStatus) return null;

    return { bucket, username, userStatus };
  }

  private async readClusterUsage() {
    const metrics = await this.execAsync(`mc admin prometheus metrics ${shQuote(this.alias)} cluster`, { ignoreError: true });
    const usage = metrics ? this.parseClusterUsage(metrics.stdout) : null;
    if (usage) return usage;

    const du = await this.execAsync(`mc du --json ${shQuote(this.alias)}`, { ignoreError: true });
    if (!du) return null;

    const parsed = this.parseDuJson(du.stdout);
    if (!parsed) return null;

    return { objects: parsed.objects, usage: parsed.size };
  }

  /** All the bucket gauges in one read; an empty map when the server does not serve them. */
  private async readBucketMetrics() {
    const result = await this.execAsync(`mc admin prometheus metrics ${shQuote(this.alias)} bucket`, { ignoreError: true });
    if (!result) return new Map<string, { objects?: number; usage?: number; hard?: number }>();

    return this.parseBucketMetrics(result.stdout);
  }

  /**
   * Every account in one read, or `null` when that read fails - which is not the
   * same as "no accounts": an empty map would drop every bucket from the listing
   * and show an empty server. `null` sends the caller back to one read per bucket.
   */
  private async readUserStatuses() {
    const result = await this.execAsync(`mc admin user list ${shQuote(this.alias)} --json`, { ignoreError: true });
    if (!result) return null;

    return this.parseUserListJson(result.stdout);
  }

  private async readUserStatus(username: string) {
    const result = await this.execAsync(`mc admin user info ${shQuote(this.alias)} ${shQuote(username)}`, { ignoreError: true });
    if (!result) return null;

    if (/Status:\s+disabled/i.test(result.stdout)) return "disabled" as const;
    if (/Status:\s+enabled/i.test(result.stdout)) return "enabled" as const;

    return null;
  }

  /** The exact figures, counted on the spot, for a bucket the scanner has nothing on. */
  private async readBucketUsage(bucket: string) {
    const usage: { objects?: number; usage?: number; hard?: number } = {};

    const du = await this.execAsync(`mc du --json ${shQuote(`${this.alias}/${bucket}`)}`, { ignoreError: true });
    if (du) {
      const parsed = this.parseDuJson(du.stdout);
      if (parsed) {
        usage.objects = parsed.objects;
        usage.usage = parsed.size;
      }
    }

    const quota = await this.execAsync(`mc quota info ${shQuote(`${this.alias}/${bucket}`)} --json`, { ignoreError: true });
    if (quota) {
      const parsed = this.parseQuotaInfoJson(quota.stdout);
      if (parsed) usage.hard = parsed.quota;
    }

    return usage;
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

  /**
   * The server's own figures. The usage used to come from `mc du` over the
   * whole alias - every object of every bucket walked to add up a total the
   * cluster gauge already carries, nine seconds on a server holding 150k
   * objects. The walk is kept for a server that does not serve the gauge.
   */
  async getMinioMetrics() {
    await this.ensureInit();

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

    const globalUsage = (await this.readClusterUsage()) ?? { objects: 0, usage: 0 };

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
