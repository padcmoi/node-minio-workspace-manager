import type { ExecOptions } from "node:child_process";
import { exec as execCallback } from "node:child_process";
import util from "node:util";
import { guessMimeTypeFromKey } from "./deps/mimetypes";
import { shQuote, slugifyBucketId } from "./deps/utils";
import { MinioWorkspaceError } from "./error";
import type { ExecAsyncOptsBase, ExecAsyncResult, JsonArray, JsonObject, MinioRuntimeOptions } from "./types";

const initializedByAlias: Record<string, boolean> = {};

export abstract class MinioCore {
  protected endpoint!: string;
  protected alias!: string;
  protected accessKey!: string;
  protected secretKey!: string;

  protected readonly enabled: boolean;
  protected readonly logger;
  protected readonly execAsyncRaw;

  constructor(runtime: MinioRuntimeOptions = {}) {
    this.enabled = runtime.enabled ?? true;
    this.logger = runtime.logger;
    const promisified = util.promisify(execCallback);
    this.execAsyncRaw = promisified as (command: string, options?: ExecOptions) => Promise<ExecAsyncResult>;
  }

  protected getErrCode(error: unknown) {
    if (typeof error !== "object" || error === null) return undefined;
    const record = error as Record<string, unknown>;
    const code = record["code"];
    if (typeof code === "string" || typeof code === "number") return code;
    return undefined;
  }

  protected getErrSignal(error: unknown) {
    if (typeof error !== "object" || error === null) return undefined;
    const record = error as Record<string, unknown>;
    const signal = record["signal"];
    if (typeof signal === "string") return signal;
    return undefined;
  }

  protected getErrText(error: unknown) {
    if (typeof error !== "object" || error === null) return "";

    const record = error as Record<string, unknown>;
    const textParts: string[] = [];

    for (const key of ["stderr", "stdout", "message"] as const) {
      const value = record[key];
      if (typeof value === "string") {
        textParts.push(value);
        continue;
      }
      if (Buffer.isBuffer(value)) {
        textParts.push(value.toString("utf8"));
      }
    }

    return textParts.join("\n").trim();
  }

  protected mapExecFailureToWorkspaceError(command: string, context: string | undefined, error: unknown) {
    const detail = this.getErrText(error).toLowerCase();
    const isAliasInit = context === "ensureInit" && command.includes("mc alias set");

    if (
      isAliasInit &&
      (detail.includes("invalid access key") ||
        detail.includes("access key id") ||
        detail.includes("signature we calculated does not match") ||
        detail.includes("provided credentials") ||
        detail.includes("access denied") ||
        detail.includes("unauthorized"))
    ) {
      return new MinioWorkspaceError({ status: 401, code: "workspace_auth_failed" });
    }

    if (
      detail.includes("connection refused") ||
      detail.includes("no such host") ||
      detail.includes("i/o timeout") ||
      detail.includes("network is unreachable")
    ) {
      return new MinioWorkspaceError({ status: 503, code: "storage_unreachable" });
    }

    return new MinioWorkspaceError({ status: 500, code: "STORAGE_ISSUE" });
  }

  protected logInfo(message: string, meta?: unknown) {
    this.logger?.info?.(message, meta);
  }

  protected logWarn(message: string, meta?: unknown) {
    this.logger?.warn?.(message, meta);
  }

  // eslint-disable-next-line no-restricted-syntax
  protected execAsync(command: string, opts?: { ignoreError?: false; ctx?: string }): Promise<ExecAsyncResult>;
  // eslint-disable-next-line no-restricted-syntax
  protected execAsync(command: string, opts: { ignoreError: true; ctx?: string }): Promise<ExecAsyncResult | null>;
  // eslint-disable-next-line no-restricted-syntax
  protected async execAsync(command: string, opts?: ExecAsyncOptsBase): Promise<ExecAsyncResult | null> {
    if (!this.enabled) {
      if (opts?.ignoreError) return null;
      return { stdout: "", stderr: "" } satisfies ExecAsyncResult;
    }

    const ignoreError = opts?.ignoreError ?? false;
    const context = opts?.ctx;

    try {
      const result: ExecAsyncResult = await this.execAsyncRaw(command, {
        env: {
          MC_CONFIG_DIR: "/tmp/mc",
          HOME: "/tmp",
          PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        },
      });
      return result;
    } catch (error) {
      const where = `${this.constructor.name}${context ? `.${context}` : ""}`;
      const code = this.getErrCode(error);
      const signal = this.getErrSignal(error);

      if (ignoreError) return null;

      this.logWarn(`[S3 Storage] ${where} mc command failed${code ? ` code=${code}` : ""}${signal ? ` signal=${signal}` : ""}`, {
        command,
      });

      throw this.mapExecFailureToWorkspaceError(command, context, error);
    }
  }

  // eslint-disable-next-line no-restricted-syntax
  protected execAsyncBuffer(command: string, opts?: { ignoreError?: false; ctx?: string }): Promise<Buffer>;
  // eslint-disable-next-line no-restricted-syntax
  protected execAsyncBuffer(command: string, opts: { ignoreError: true; ctx?: string }): Promise<Buffer | null>;
  // eslint-disable-next-line no-restricted-syntax
  protected execAsyncBuffer(command: string, opts?: ExecAsyncOptsBase): Promise<Buffer | null> {
    if (!this.enabled) {
      if (opts?.ignoreError) return Promise.resolve(null);
      return Promise.resolve(Buffer.alloc(0));
    }

    const ignoreError = opts?.ignoreError ?? false;
    const context = opts?.ctx;

    return new Promise<Buffer | null>((resolve, reject) => {
      execCallback(
        command,
        {
          encoding: "buffer",
          maxBuffer: 50 * 1024 * 1024,
          env: {
            MC_CONFIG_DIR: "/tmp/mc",
            HOME: "/tmp",
            PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          },
        },
        (error, stdout) => {
          if (error) {
            const where = `${this.constructor.name}${context ? `.${context}` : ""}`;
            const code = this.getErrCode(error);
            const signal = this.getErrSignal(error);

            if (ignoreError) {
              resolve(null);
              return;
            }

            this.logWarn(
              `[S3 Storage] ${where} mc command failed${code ? ` code=${code}` : ""}${signal ? ` signal=${signal}` : ""}`,
              {
                command,
              }
            );

            reject(this.mapExecFailureToWorkspaceError(command, context, error));
            return;
          }

          const stdoutBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
          resolve(stdoutBuffer);
        }
      );
    });
  }

  async ensureInit(bucket?: string) {
    if (!this.enabled) return;

    if (initializedByAlias[this.alias]) return;

    try {
      await this.execAsync(
        `mc alias set ${shQuote(this.alias)} ${shQuote(this.endpoint)} ${shQuote(this.accessKey)} ${shQuote(this.secretKey)}`,
        { ctx: "ensureInit" }
      );

      initializedByAlias[this.alias] = true;
      this.logInfo(`[S3 Storage] user client ready endpoint=${this.endpoint}${bucket ? ` bucket=${bucket}` : ""}`);
    } catch (error) {
      delete initializedByAlias[this.alias];

      if (error instanceof MinioWorkspaceError) throw error;
      throw new MinioWorkspaceError({ status: 500, code: "STORAGE_ISSUE" });
    }
  }

  protected resolveNames(name: string) {
    const safeName = slugifyBucketId(name);

    return {
      safeName,
      bucket: `bucket-${safeName}`,
      username: `user-${safeName}`,
      policyName: `custom-policy-${safeName}`,
    };
  }

  protected parseJson(text: string) {
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return null;
    }
  }

  protected coerceJsonValue(value: unknown) {
    if (value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value;

    if (Array.isArray(value)) {
      const out: JsonArray = [];
      for (const item of value) {
        const coerced = this.coerceJsonValue(item);
        if (coerced === undefined) return undefined;
        out.push(coerced);
      }
      return out;
    }

    if (typeof value === "object") {
      const out: JsonObject = {};
      for (const [key, value0] of Object.entries(value ?? {})) {
        const coerced = this.coerceJsonValue(value0);
        if (coerced === undefined) return undefined;
        out[key] = coerced;
      }
      return out;
    }

    return undefined;
  }

  protected toJsonObject(value: unknown) {
    const coerced = this.coerceJsonValue(value);
    if (coerced === undefined) return null;
    if (typeof coerced !== "object" || coerced === null || Array.isArray(coerced)) return null;
    return coerced;
  }

  protected toJsonArray(value: unknown) {
    const coerced = this.coerceJsonValue(value);
    if (coerced === undefined) return null;
    if (!Array.isArray(coerced)) return null;
    return coerced;
  }

  protected parseDuJson(text: string) {
    const parsed = this.parseJson(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const objects = record["objects"];
    const size = record["size"];

    if (typeof objects !== "number") return null;
    if (typeof size !== "number") return null;

    return { objects, size };
  }

  protected parseQuotaInfoJson(text: string) {
    const parsed = this.parseJson(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const quota = record["quota"];

    if (typeof quota !== "number") return null;

    return { quota };
  }

  /** The samples of a Prometheus exposition, as `mc admin prometheus metrics` prints them. */
  protected parseMetricSamples(text: string) {
    const samples: { name: string; labels: string; value: number }[] = [];

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const sample = /^([a-z_]+)(?:\{([^}]*)\})?\s+(\S+)$/.exec(trimmed);
      if (!sample) continue;

      const value = Number(sample[3]);
      if (!Number.isFinite(value)) continue;

      samples.push({ name: sample[1], labels: sample[2] ?? "", value });
    }

    return samples;
  }

  /**
   * The three bucket gauges of `mc admin prometheus metrics <alias> bucket`,
   * keyed by bucket. One read of the server's own figures replaces a `mc du`
   * per bucket, which walks every object to add up what MinIO already knows.
   *
   * A bucket can be reported by several servers at once; they publish the same
   * cluster-wide figure rather than a share of it, so the highest value is the
   * value, and summing them would multiply the usage by the size of the pool.
   */
  protected parseBucketMetrics(text: string) {
    const fields: Record<string, "objects" | "usage" | "hard"> = {
      minio_bucket_usage_object_total: "objects",
      minio_bucket_usage_total_bytes: "usage",
      minio_bucket_quota_total_bytes: "hard",
    };

    const out = new Map<string, { objects?: number; usage?: number; hard?: number }>();

    for (const sample of this.parseMetricSamples(text)) {
      const field = fields[sample.name];
      if (!field) continue;

      const bucket = /bucket="([^"]*)"/.exec(sample.labels)?.[1];
      if (!bucket) continue;

      const entry = out.get(bucket) ?? {};
      const held = entry[field];
      if (held === undefined || sample.value > held) entry[field] = sample.value;

      out.set(bucket, entry);
    }

    return out;
  }

  /** What the whole server holds, from the cluster gauges; `null` when they are not served. */
  protected parseClusterUsage(text: string) {
    let objects: number | undefined;
    let usage: number | undefined;

    for (const sample of this.parseMetricSamples(text)) {
      if (sample.name === "minio_cluster_usage_object_total") objects = Math.max(objects ?? 0, sample.value);
      if (sample.name === "minio_cluster_usage_total_bytes") usage = Math.max(usage ?? 0, sample.value);
    }

    if (objects === undefined || usage === undefined) return null;

    return { objects, usage };
  }

  /** The status of every account, from the one line `mc admin user list --json` prints per user. */
  protected parseUserListJson(text: string) {
    const out = new Map<string, "enabled" | "disabled">();

    for (const line of text.split("\n")) {
      const record = this.parseJsonLine(line.trim());
      if (!record) continue;

      const accessKey = record["accessKey"];
      const status = record["userStatus"];

      if (typeof accessKey !== "string") continue;
      if (status !== "enabled" && status !== "disabled") continue;

      out.set(accessKey, status);
    }

    return out;
  }

  protected parseAdminInfoJson(text: string) {
    const parsed = this.parseJson(text);
    const raw = this.toJsonObject(parsed);
    if (!raw) return null;

    const version = typeof raw["version"] === "string" ? raw["version"] : null;

    const uptimeRaw = raw["uptime"];
    const uptime = typeof uptimeRaw === "string" || typeof uptimeRaw === "number" ? uptimeRaw : null;

    const region = typeof raw["region"] === "string" ? raw["region"] : null;
    const mode = typeof raw["mode"] === "string" ? raw["mode"] : null;

    const pools = this.toJsonArray(raw["pools"]) ?? [];
    const disks = this.toJsonArray(raw["disks"]) ?? [];

    return {
      version,
      uptime,
      region,
      mode,
      pools,
      disks,
      raw,
    };
  }

  protected parseJsonLine(line: string) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  public guessMimeTypeFromKey = guessMimeTypeFromKey;
}
