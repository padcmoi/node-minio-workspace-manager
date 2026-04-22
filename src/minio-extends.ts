import { MinioState } from "./minio-state";
import type { MinioRuntimeOptions } from "./types";

export abstract class MinioExtends extends MinioState {
  constructor(runtime: MinioRuntimeOptions = {}) {
    super(runtime);
  }
}
