import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { assertNamespace, dateNowMs, generateRandomHex, joinKey, normalizePart, shQuote } from "./deps/utils";
import { MinioWorkspaceError } from "./error";
import { MinioExtends } from "./minio-extends";
import type { MinioRuntimeOptions, MinioUserListItem, MinioUserUploadItem, S3StoreConfig, UploadedFile } from "./types";

export class MinioBucketManager extends MinioExtends {
  private readonly bucket: string;

  constructor(config: S3StoreConfig, runtime: MinioRuntimeOptions = {}) {
    super(runtime);
    this.bucket = config.bucket.trim();
    this.accessKey = config.accessKey.trim();
    this.secretKey = config.secretKey;

    const proto = config.useSSL ? "https" : "http";
    const host = config.host.trim();

    this.endpoint = `${proto}://${host}:${config.port}`;

    const raw = `${proto}|${host}|${config.port}|${this.bucket}|${this.accessKey}`;
    const hash = createHash("md5").update(raw, "utf8").digest("hex");
    this.alias = `s_${hash}`;
  }

  async listObjects(namespace: string, prefix: string = "") {
    await this.ensureInit(this.bucket);

    const ns = assertNamespace(namespace);

    let pref = normalizePart(prefix);

    if (pref === ns) pref = "";
    else if (pref.startsWith(`${ns}/`)) pref = pref.slice(ns.length + 1);

    const target = pref ? `${this.alias}/${this.bucket}/${joinKey(ns, pref)}` : `${this.alias}/${this.bucket}/${ns}`;

    const { stdout } = await this.execAsync(`mc ls --json --recursive ${shQuote(target)}`);

    const objects: MinioUserListItem[] = [];

    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;

      const object = this.parseJsonLine(line);
      if (!object) continue;

      const key0 = typeof object["key"] === "string" ? object["key"] : null;
      const size0 = typeof object["size"] === "number" ? object["size"] : null;

      if (!key0 || size0 === null) continue;

      const etag0 = typeof object["etag"] === "string" ? object["etag"] : null;
      const lastModified0 = typeof object["lastModified"] === "string" ? object["lastModified"] : null;

      const full = key0.startsWith(`${ns}/`) ? key0 : joinKey(ns, key0);

      objects.push({ key: full, size: size0, lastModified: lastModified0, etag: etag0 });
    }

    return { bucket: this.bucket, namespace: ns, count: objects.length, objects };
  }

  async uploadMany(namespace: string, files: UploadedFile[], prefix: string = "", refs: string[]) {
    await this.ensureInit(this.bucket);

    const bucketQuotaState = this.quotasState[this.bucket];

    if (bucketQuotaState) {
      const totalIncoming = files.reduce((sum, file) => sum + file.size, 0);
      if (bucketQuotaState.hard > 0 && bucketQuotaState.cur + totalIncoming > bucketQuotaState.hard) {
        throw new MinioWorkspaceError({ status: 413, code: "quota_exceeded" });
      }
    }

    const ns = assertNamespace(namespace);
    const pref = normalizePart(prefix);

    const fs = await import("node:fs/promises");
    const uploaded: MinioUserUploadItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ref = refs[i] ?? "";
      const tmpPath = path.join("/tmp", `s3-upload-${randomUUID()}`);

      const extensionRaw = path.extname(file.originalname);
      const extension = extensionRaw ? extensionRaw.toLowerCase() : "";
      const fileName = `${Math.round(dateNowMs())}${generateRandomHex()}${extension}`;

      const key = joinKey(ns, pref, fileName);

      try {
        await fs.writeFile(tmpPath, file.buffer);

        const destination = `${this.alias}/${this.bucket}/${key}`;
        await this.execAsync(`mc cp ${shQuote(tmpPath)} ${shQuote(destination)}`);

        uploaded.push({ ref, key: joinKey(namespace, pref, fileName), size: file.size });
      } finally {
        try {
          await fs.unlink(tmpPath);
        } catch {
          // ignore tmp cleanup failure
        }
      }
    }

    await this.currentQuota(this.bucket);

    return { bucket: this.bucket, namespace: ns, uploaded };
  }

  async deleteObjects(namespace: string, keys: string[]) {
    await this.ensureInit(this.bucket);

    const ns = assertNamespace(namespace);

    const deleted: string[] = [];
    const failed: { key: string; reason: string }[] = [];

    for (const rawKey of keys) {
      let key = normalizePart(rawKey);
      if (!key) continue;

      const aliasBucketPrefix = `${this.alias}/${this.bucket}/`;
      const bucketPrefix = `${this.bucket}/`;

      if (key.startsWith(aliasBucketPrefix)) key = key.slice(aliasBucketPrefix.length);
      if (key.startsWith(bucketPrefix)) key = key.slice(bucketPrefix.length);

      key = normalizePart(key);
      if (!key) continue;

      const fullKey = key.startsWith(`${ns}/`) ? key : joinKey(ns, key);
      const target = `${this.alias}/${this.bucket}/${fullKey}`;

      const out = await this.execAsync(`mc rm --force ${shQuote(target)}`, { ignoreError: true });

      if (out === null) {
        failed.push({ key, reason: "delete_failed" });
      } else {
        deleted.push(fullKey);
      }
    }

    await this.currentQuota(this.bucket);

    return { bucket: this.bucket, namespace: ns, deleted, failed };
  }

  async downloadObjectBuffer(namespace: string, key: string) {
    await this.ensureInit(this.bucket);

    const ns = assertNamespace(namespace);

    let relative = normalizePart(key);
    if (!relative) throw new MinioWorkspaceError({ status: 400, code: "invalid_path_1" });

    if (relative === ns) throw new MinioWorkspaceError({ status: 400, code: "invalid_path_2" });
    if (relative.startsWith(`${ns}/`)) relative = relative.slice(ns.length + 1);

    relative = normalizePart(relative);
    if (!relative) throw new MinioWorkspaceError({ status: 400, code: "invalid_path_3" });

    const fullKey = joinKey(ns, relative);
    const target = `${this.alias}/${this.bucket}/${fullKey}`;

    try {
      return await this.execAsyncBuffer(`mc cat ${shQuote(target)}`);
    } catch {
      throw new MinioWorkspaceError({ status: 404, code: "not_found" });
    }
  }
}
