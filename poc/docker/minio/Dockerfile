FROM golang:1.24-alpine AS build
ARG MINIO_RELEASE=RELEASE.2025-04-22T22-12-26Z
ARG MC_RELEASE=RELEASE.2025-04-16T18-13-26Z
ENV CGO_ENABLED=0
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "$MINIO_RELEASE" https://github.com/minio/minio.git /src/minio \
  && cd /src/minio \
  && go build -tags kqueue -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio .
RUN git clone --depth 1 --branch "$MC_RELEASE" https://github.com/minio/mc.git /src/mc \
  && cd /src/mc \
  && go build -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/mc .
RUN cp /src/minio/dockerscripts/docker-entrypoint.sh /out/docker-entrypoint.sh

FROM alpine:3
RUN apk add --no-cache ca-certificates curl bash
ENV MINIO_ACCESS_KEY_FILE=access_key \
    MINIO_SECRET_KEY_FILE=secret_key \
    MINIO_ROOT_USER_FILE=access_key \
    MINIO_ROOT_PASSWORD_FILE=secret_key \
    MINIO_KMS_SECRET_KEY_FILE=kms_master_key \
    MINIO_UPDATE_MINISIGN_PUBKEY="RWTx5Zr1tiHQLwG9keckT0c45M3AGeHD6IvimQHpyRywVWGbP1aVSGav" \
    MINIO_CONFIG_ENV_FILE=config.env \
    MC_CONFIG_DIR=/tmp/.mc
COPY --from=build /out/minio /out/mc /usr/bin/
COPY --from=build /out/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
RUN chmod +x /usr/bin/minio /usr/bin/mc /usr/bin/docker-entrypoint.sh
EXPOSE 9000
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]
