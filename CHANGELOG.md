# CHANGELOG

## [1.1.0] - 2026-10-06

- Read `listBuckets` usage, object count and quota from the bucket gauges MinIO publishes (`mc admin prometheus metrics <alias> bucket`) and account status from `mc admin user list`: two reads for the whole server, where every bucket used to cost five `mc` processes, two of them a `mc du` walking each object to add up a size the server already held. On a server of 7 buckets, one of them 124k objects, the call goes from 19 s to under a second.
- Drop the `resetStateQuota` call `listBuckets` made per bucket: it spent a second `mc du` and a second `mc quota info` to fill an admin-side state that nothing reads back (`MinioBucketManager` keeps its own).
- Keep the exact count for anything the scanner has no figure for - a server too old for the endpoint, a bucket created a moment ago - by falling back to `mc du` for those buckets only, 4 at a time instead of one after the other.
- Add `MinioAdminManager.findWorkspace(bucket)`: does this bucket exist, and does it have an account.
- Resolve `getStore(storeId)` through `findWorkspace` instead of `listBuckets`, so opening one file no longer walks every object of every bucket on the server. This is the call behind `minioBucketService(storeId)`, so it was paid by every upload, download and object listing.
- Read the `getMinioMetrics` usage from the cluster gauge instead of `mc du` over the whole alias, which walked every object of every bucket to total what the server already publishes: 9 s on a server holding 150k objects. The walk is kept for a server that does not serve the gauge.
- Call `ensureInit()` in `getMinioMetrics`, like every other call that shells out: it was the one that assumed the alias had already been set by something else.
- Add unit tests covering the gauge-based listing, the per-bucket fallback, the per-account fallback when `mc admin user list` cannot be read, `findWorkspace`, and the cluster usage with its fallback.

## [1.0.3] - 2026-09-24

- Build `mc` `RELEASE.2025-04-16T18-13-26Z` from its source in the POC image: `dl.min.io` now answers 410.
- Build the MinIO server `RELEASE.2025-04-22T22-12-26Z` from its source in the POC stack: Docker Hub and quay.io now refuse its image.
- Document in the README how to build the pinned server and `mc` from their source.

## [1.0.2] - 2026-05-03

- Make `upsertBucket` idempotent on existing buckets by using `mc mb --ignore-existing`.
- Fix `ignoreError` existence checks in admin flow (`upsertBucket`, `deleteBucket`) to rely on `null` responses instead of `try/catch`.
- Improve command failure mapping with explicit MinIO runtime errors:
  - `workspace_auth_failed` (401) for workspace credential mismatch during alias initialization.
  - `storage_unreachable` (503) for network/connectivity issues.
- Fix alias initialization state handling so failed `ensureInit` attempts do not leave aliases cached as initialized.
- Add unit tests covering:
  - idempotent bucket creation command flag,
  - workspace auth error mapping,
  - retry behavior after failed initialization.

## [1.0.1] - 2026-04-22

- Set dynamic bucket page HTML title in POC route rendering: `/bucket/:storeId` now renders `MinIO POC - bucket-store-<storeId>`.
- Escape injected bucket label when composing the HTML `<title>` to prevent unsafe characters from being rendered as markup.

## [1.0.0] - 2026-04-22

- Extract MinIO workspace manager from starter-template with preserved hardcoded usage flow (`storeId -> bucket-store-*`).
- Add framework-agnostic service + admin + bucket managers (`upsert/list/info/enable/delete`, `upload/list/delete/download/view`).
- Add unit and integration tests for utils, service resolution, and admin/bucket behavior.
- Add Express POC with admin/storage routes and Docker compose MinIO test stack.
- Add documentation (`README`, `docs/express.md`, `docs/nestjs.md`, `docs/helpers.md`) including explicit MinIO compatibility constraints.
- Refactor naming from `agency` to global `store` across code, tests, docs, and POC defaults.
- Add POC web UI (`/`) served from MVC view file (`poc/src/views/home-page.html`) to execute all API actions from a single page.
- Add POC buckets list UX refinement: inline `Disable` action placed just before `Use` for store access control visibility.
- Update POC dev workflow with HTML live reload (`nodemon` watches `ts,html`) and Docker bind mount for live source updates.
- Update POC default MinIO credentials to `admin` / `ChangeThisPassword123!`.
- Clarify compatibility statement: future MinIO versions are not supported because the communication mechanism used by this library was removed.
