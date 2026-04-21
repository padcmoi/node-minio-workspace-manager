import express from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  bucketInfoController,
  deleteBucketController,
  deleteFilesController,
  downloadFileController,
  listBucketsController,
  listFilesController,
  setBucketEnabledController,
  uploadFilesController,
  upsertBucketController,
  viewFileController,
} from "../controllers/minio.controller";

const upload = multer({ storage: multer.memoryStorage() });

export const router = express.Router();

const homePageCandidates = [
  join(process.cwd(), "src", "views", "home-page.html"),
  join(process.cwd(), "poc", "src", "views", "home-page.html"),
  join(__dirname, "..", "views", "home-page.html"),
];

const homePagePath = homePageCandidates.find((filePath) => existsSync(filePath));

router.get("/", (_req, res) => {
  if (!homePagePath) {
    res.status(500).type("text/plain").send("View not found: home-page.html");
    return;
  }

  res.sendFile(homePagePath);
});

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "node-minio-workspace-manager-poc" });
});

router.post("/admin/buckets/:name/upsert", async (req, res, next) => {
  try {
    const data = await upsertBucketController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/admin/buckets/:name", async (req, res, next) => {
  try {
    const data = await deleteBucketController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/admin/buckets", async (_req, res, next) => {
  try {
    const data = await listBucketsController();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/admin/buckets/:name", async (req, res, next) => {
  try {
    const data = await bucketInfoController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/admin/buckets/:name/enabled", async (req, res, next) => {
  try {
    const data = await setBucketEnabledController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/storage/:storeId/:namespace/files", upload.array("files", 50), async (req, res, next) => {
  try {
    const data = await uploadFilesController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/storage/:storeId/:namespace/files", async (req, res, next) => {
  try {
    const data = await listFilesController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.delete("/storage/:storeId/:namespace/files", async (req, res, next) => {
  try {
    const data = await deleteFilesController(req);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/storage/:storeId/:namespace/file", async (req, res, next) => {
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

router.get("/storage/:storeId/:namespace/view", async (req, res, next) => {
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
