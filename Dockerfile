FROM node:22-bookworm-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm typecheck
CMD ["pnpm", "dev:api"]
