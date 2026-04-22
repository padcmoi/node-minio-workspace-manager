import express from "express";
import multer from "multer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bucketInfoController,
  bucketPageContextController,
  deleteBucketController,
  deleteFilesController,
  downloadFileController,
  listBucketsController,
  listBucketTreeController,
  listFilesController,
  minioMetricsController,
  setBucketEnabledController,
  uploadFilesController,
  upsertBucketController,
  viewFileController,
} from "../controllers/minio.controller";

const upload = multer({ storage: multer.memoryStorage() });

export const router = express.Router();

function findFirstExisting(candidates: string[]) {
  return candidates.find((filePath) => existsSync(filePath)) ?? null;
}

function viewPath(fileName: string) {
  return findFirstExisting([
    join(__dirname, "..", "..", "src", "views", fileName),
    join(process.cwd(), "src", "views", fileName),
    join(process.cwd(), "poc", "src", "views", fileName),
    join(__dirname, "..", "views", fileName),
  ]);
}

function sendView(res: express.Response, fileName: string) {
  const filePath = viewPath(fileName);

  if (!filePath) {
    res.status(500).type("text/plain").send(`View not found: ${fileName}`);
    return;
  }

  res.sendFile(filePath);
}

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendBucketView(req: express.Request, res: express.Response) {
  const filePath = viewPath("bucket-page.html");

  if (!filePath) {
    res.status(500).type("text/plain").send("View not found: bucket-page.html");
    return;
  }

  const html = readFileSync(filePath, "utf8");
  const context = await bucketPageContextController(req);
  const injected = html
    .replace("__POC_BUCKET_TITLE__", escapeHtml(context.bucketLabel))
    .replace("__POC_BUCKET_CONTEXT_JSON__", serializeForInlineScript(context));

  res.type("html").send(injected);
}

const publicDirCandidates = [
  join(__dirname, "..", "..", "src", "public"),
  join(process.cwd(), "src", "public"),
  join(process.cwd(), "poc", "src", "public"),
  join(__dirname, "..", "public"),
];

for (const publicDir of publicDirCandidates) {
  if (existsSync(publicDir)) {
    router.use("/public", express.static(publicDir));
  }
}

router.get("/", (_req, res) => {
  sendView(res, "stats-page.html");
});

router.get("/buckets", (_req, res) => {
  sendView(res, "buckets-page.html");
});

router.get("/bucket/:storeId", async (req, res, next) => {
  try {
    await sendBucketView(req, res);
  } catch (error) {
    next(error);
  }
});

router.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "node-minio-workspace-manager-poc" });
});

router.post("/api/admin/buckets/:name/upsert", async (req, res, next) => {
  try {
    const data = await upsertBucketController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/admin/buckets/:name", async (req, res, next) => {
  try {
    const data = await deleteBucketController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/buckets", async (_req, res, next) => {
  try {
    const data = await listBucketsController();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/metrics", async (_req, res, next) => {
  try {
    const data = await minioMetricsController();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/admin/buckets/:name", async (req, res, next) => {
  try {
    const data = await bucketInfoController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/api/admin/buckets/:name/enabled", async (req, res, next) => {
  try {
    const data = await setBucketEnabledController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/api/storage/:storeId/:namespace/files", upload.array("files", 50), async (req, res, next) => {
  try {
    const data = await uploadFilesController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/storage/:storeId/:namespace/files", async (req, res, next) => {
  try {
    const data = await listFilesController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/storage/:storeId/tree", async (req, res, next) => {
  try {
    const data = await listBucketTreeController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/storage/:storeId/:namespace/files", async (req, res, next) => {
  try {
    const data = await deleteFilesController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/api/storage/:storeId/:namespace/file", async (req, res, next) => {
  try {
    const data = await downloadFileController(req);
    const encoded = encodeURIComponent(data.filename);

    res.setHeader("Content-Type", data.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${data.disposition}; filename*=UTF-8''${encoded}`);
    res.send(data.buffer);
  } catch (error) {
    next(error);
  }
});

router.get("/api/storage/:storeId/:namespace/view", async (req, res, next) => {
  try {
    const data = await viewFileController(req);

    res.setHeader("Content-Type", data.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${data.disposition}; filename=\"${data.filename.replaceAll('"', "")}\"`);
    res.send(data.buffer);
  } catch (error) {
    next(error);
  }
});
