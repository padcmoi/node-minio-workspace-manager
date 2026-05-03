# API Reference

## Compatibility Note

Validated target image:

- `minio/minio:RELEASE.2025-04-22T22-12-26Z`

No compatibility guarantee for higher or lower MinIO versions.

## Main classes

- `MinioWorkspaceService`
- `MinioAdminManager`
- `MinioBucketManager`

## `MinioWorkspaceService`

```ts
new MinioWorkspaceService({
  endpoint,
  containerName,
  rootUser,
  rootPassword,
  alias,
  // optional
  storeBucketPrefix,
  defaultStoreSecretKey,
  workspaceHost,
  workspacePort,
  workspaceUseSSL,
  runtime,
  mapStoreIdToBucketName,
  mapWorkspaceToStoreConfig,
});
```

Methods:

- `getStore(storeId)` -> resolves store config from admin workspace list
- `minioBucketService(storeId)` -> returns `MinioBucketManager`

Default hardcoded behavior preserved:

- expected bucket name: `bucket-store-${storeId}`
- default generated store secret: `123456789`

## `MinioAdminManager`

Methods:

- `ensureInit()`
- `upsertBucket(name, { password?, quotaMb? })`
- `deleteBucket(name)`
- `listBuckets()`
- `getBucketInfo(name)`
- `setBucketEnabled(name, enabled)`
- `getMinioMetrics()`
- `resetStateQuota(bucket)`

## `MinioBucketManager`

Methods:

- `listObjects(namespace, prefix?)`
- `uploadMany(namespace, files, prefix?, refs)`
- `deleteObjects(namespace, keys)`
- `downloadObjectBuffer(namespace, key)`
- `guessMimeTypeFromKey(key)`

## Errors

Library errors are thrown as `MinioWorkspaceError` with:

- `status?`
- `code?`
- `message`
- `details?`

Typical codes:

- `store_not_found`
- `password_required_for_creation`
- `quota_exceeded`
- `not_found`
- `namespace_required`
- `invalid_namespace`
- `workspace_auth_failed`
- `storage_unreachable`
- `STORAGE_ISSUE`
