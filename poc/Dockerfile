FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npm run build

WORKDIR /app/poc
RUN npm install && npm run build

EXPOSE 3010

CMD ["npm", "run", "start"]
