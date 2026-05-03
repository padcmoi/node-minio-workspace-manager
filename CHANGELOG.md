# CHANGELOG

## [Unreleased] - yyyy-mm-dd

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
