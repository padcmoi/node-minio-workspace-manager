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

- `getStore(storeId)` -> resolves store config from that bucket alone (`findWorkspace`), without listing the server
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
- `findWorkspace(bucket)` -> `{ bucket, username, userStatus }` or `null`, for one bucket
- `getBucketInfo(name)`
- `setBucketEnabled(name, enabled)`
- `getMinioMetrics()`
- `resetStateQuota(bucket)`

`listBuckets()` reads usage, object count and quota from the bucket gauges MinIO
publishes (`mc admin prometheus metrics <alias> bucket`), and account status from
`mc admin user list`: two reads for the whole server instead of five `mc` calls
per bucket. Those gauges come from the data usage scanner, so they trail reality
by a scan cycle; a bucket the scanner has no figure for is still counted exactly
with `mc du`. For an on-the-spot count of a single bucket, use `getBucketInfo`.

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
