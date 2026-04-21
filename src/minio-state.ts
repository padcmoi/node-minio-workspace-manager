import type { BucketQuotaState, MinioRuntimeOptions } from "./types";
import { MinioCore } from "./minio-core";
import { shQuote } from "./deps/utils";

export abstract class MinioState extends MinioCore {
  protected readonly quotasState: BucketQuotaState;

  constructor(runtime: MinioRuntimeOptions = {}) {
    super(runtime);
    this.quotasState = {};
  }

  protected getQuotaState(bucket: string) {
    const current = this.quotasState[bucket];
    if (current) return current;

    const fallback = { hard: 0, cur: 0 };
    this.quotasState[bucket] = fallback;
    return fallback;
  }

  protected async currentQuota(bucket: string) {
    let quotaCur: number | undefined;

    try {
      const { stdout } = await this.execAsync(`mc du --json ${shQuote(this.alias)}/${shQuote(bucket)}`);
      const line = stdout.trim().split("\n").pop() ?? "";
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) {
        const size = (parsed as Record<string, unknown>).size;
        if (typeof size === "number") quotaCur = size;
      }

      const state = this.getQuotaState(bucket);
      if (quotaCur !== undefined) state.cur = quotaCur;
    } catch {
      // ignore parse/runtime errors to match original tolerant behavior
    }

    return quotaCur;
  }
}
