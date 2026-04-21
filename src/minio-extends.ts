import type { MinioRuntimeOptions } from "./types";
import { MinioState } from "./minio-state";

export abstract class MinioExtends extends MinioState {
  constructor(runtime: MinioRuntimeOptions = {}) {
    super(runtime);
  }
}
