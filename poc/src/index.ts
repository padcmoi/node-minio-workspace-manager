import express from "express";
import { router } from "./routes";
import { minioAdminService, toMinioErrorPayload } from "./services/minio.service";

const port = Number(process.env.POC_PORT ?? 3010);

async function bootstrap() {
  await minioAdminService.ensureInit();

  const app = express();
  app.use(express.json());
  app.use(router);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const libError = toMinioErrorPayload(error);

    if (libError) {
      res.status(libError.status).json({
        ok: false,
        code: libError.code,
        message: libError.message,
        details: libError.details,
      });
      return;
    }

    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message });
  });

  app.listen(port, () => {
    console.info(`POC started on http://127.0.0.1:${port}`);
    console.info("Use admin route to create a bucket first, e.g. POST /admin/buckets/store-demo/upsert");
  });
}

void bootstrap();
