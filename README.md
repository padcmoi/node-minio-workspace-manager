# @naskot/node-minio-workspace-manager

Node.js MinIO workspace manager extracted from `api-starter-template` usage.

- Admin workspace lifecycle: create/update/delete bucket + user + policy + quota
- Bucket operations: list, upload (single/multi), delete, download/view
- Service layer with `storeId -> bucket` resolution (same hardcoded flow as starter-template)
- Framework-agnostic core (usable from Express, NestJS, or any Node runtime)

## MinIO Compatibility (Important)

This library is validated for Docker MinIO image:

- `minio/minio:RELEASE.2025-04-22T22-12-26Z`

Important constraints:

- Versions **higher** than `RELEASE.2025-04-22T22-12-26Z` are not supported: future MinIO releases removed the communication mechanism this library relies on.
- Versions **older** than `RELEASE.2025-04-22T22-12-26Z` are not guaranteed.

## Install

```bash
npm i @naskot/node-minio-workspace-manager
```

## Usage (Agnostic)

The library is service-first:

- Create one `minio.service.ts` as the single runtime access point.
- Route all controllers/resources through this service.
- Keep direct library imports outside this service only for minor TypeScript type-only needs.

For implementation details, use framework docs:

- Express setup and service wiring: [docs/express.md](./docs/express.md)
- NestJS setup and service wiring: [docs/nestjs.md](./docs/nestjs.md)

## Documentation

- Express guide: [docs/express.md](./docs/express.md)
- NestJS guide: [docs/nestjs.md](./docs/nestjs.md)
- API reference: [docs/helpers.md](./docs/helpers.md)

## POC

A full Express proof-of-concept is available in [`poc/`](./poc):

- Admin routes (`upsert/list/info/enable/delete`)
- Storage routes (`upload/list/delete/download/view`)
- Docker compose with MinIO version lock

Quick run:

```bash
cd poc
docker compose up --build
```

Then test:

- API: `http://127.0.0.1:3010`
- MinIO console: `http://127.0.0.1:9090`

## Local checks

```bash
npm run lint
npm run check
npm test
npm run build
```
