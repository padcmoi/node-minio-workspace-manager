FROM golang:1.24-alpine AS mc
ARG MC_RELEASE=RELEASE.2025-04-16T18-13-26Z
ENV CGO_ENABLED=0
RUN apk add --no-cache git \
  && git clone --depth 1 --branch "$MC_RELEASE" https://github.com/minio/mc.git /src
WORKDIR /src
RUN go build -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /usr/bin/mc .

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=mc /usr/bin/mc /usr/local/bin/mc

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npm run build

WORKDIR /app/poc
RUN npm install && npm run build

EXPOSE 3010

CMD ["npm", "run", "start"]
