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

      throw new MinioWorkspaceError({ status: 500, code: "STORAGE_ISSUE" });
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

            reject(new MinioWorkspaceError({ status: 500, code: "STORAGE_ISSUE" }));
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

    try {
      if (!initializedByAlias[this.alias]) {
        initializedByAlias[this.alias] = true;

        await this.execAsync(
          `mc alias set ${shQuote(this.alias)} ${shQuote(this.endpoint)} ${shQuote(this.accessKey)} ${shQuote(this.secretKey)}`,
          { ctx: "ensureInit" }
        );

        this.logInfo(`[S3 Storage] user client ready endpoint=${this.endpoint}${bucket ? ` bucket=${bucket}` : ""}`);
      }
    } catch {
      throw new MinioWorkspaceError({ status: 500, code: `[S3 Storage] ${this.constructor.name} error` });
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
